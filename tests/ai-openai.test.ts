import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAI } from "@/lib/ai/provider";
import { AI_OUTPUT_JSON_SCHEMA, parseAIOutput } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";

const payload = {
  insufficient: false,
  insight: {
    title: "Стабильная готовность",
    category: "recovery",
    severity: "info",
    observation: "Показатели стабильны.",
    interpretation: "Нет тревожных сигналов.",
    sections: [],
    watch: [],
    positives: ["Сон в норме"],
    questions: [],
    evidence: [],
    recommendations: [{ action: "Продолжать режим", rationale: "Всё стабильно" }],
    confidence: "medium",
    limitations: [],
    period: { from: "2026-11-01", to: "2026-11-14" },
  },
};

const respOk = (text: string) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output_text: text,
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    }),
    { status: 200 },
  );

const opts = (lang: "ru" | "ro" | "en" = "ru") => ({
  system: SYSTEM_PROMPT,
  user: buildUserPrompt({ athlete_code: "ATH-01", lang }, lang),
  jsonSchema: AI_OUTPUT_JSON_SCHEMA,
  validate: (d: unknown) => parseAIOutput(d) !== null,
});

describe("AI Provider — OpenAI Responses API", () => {
  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_PROVIDER = "openai";
    process.env.AI_DISABLE_CACHE = "true";
    delete process.env.AI_MODEL;
    delete process.env.AI_MODELS;
    delete process.env.AI_FALLBACK_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.AI_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("sends Responses API shape with strict json_schema and parses output_text", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      bodies.push(JSON.parse(String(init?.body)));
      return respOk(JSON.stringify(payload));
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.usage.model).toBe("gpt-6-luna");
      expect(res.usage.input_tokens).toBe(120);
    }
    const body = bodies[0];
    expect(body.model).toBe("gpt-6-luna");
    expect(body.instructions).toBe(SYSTEM_PROMPT);
    expect(body.store).toBe(false);
    expect((body.text as Record<string, unknown>).format).toMatchObject({
      type: "json_schema",
      name: AI_OUTPUT_JSON_SCHEMA.name,
      strict: true,
    });
    expect(body.messages).toBeUndefined();
    expect(body.input).toBeTruthy();
  });

  it("parses output[] message items and detects refusals as fatal", async () => {
    process.env.AI_MODELS = "gpt-6-luna,gpt-5.4-mini";
    const modelsCalled: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(b.model);
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "cannot help" }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("refusal");
    // Refusal is request-level — must NOT burn the fallback model.
    expect(modelsCalled).toEqual(["gpt-6-luna"]);
  });

  it("retries incomplete responses once, then fails over", async () => {
    process.env.AI_MODELS = "gpt-6-luna,gpt-5.4-mini";
    let lunaCalls = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      if (b.model === "gpt-6-luna") {
        lunaCalls++;
        return new Response(
          JSON.stringify({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 50, output_tokens: 2500 },
          }),
          { status: 200 },
        );
      }
      return respOk(JSON.stringify(payload));
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.usage.model).toBe("gpt-5.4-mini");
    expect(lunaCalls).toBe(2); // MAX_ATTEMPTS_PER_MODEL
  });

  it("fails over to next model on HTTP 429", async () => {
    process.env.AI_MODELS = "gpt-6-luna,gpt-5.4-mini";
    const modelsCalled: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(b.model);
      if (b.model === "gpt-6-luna") {
        return new Response('{"error":{"message":"rate limited"}}', {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return respOk(JSON.stringify(payload));
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(true);
    expect(modelsCalled).toEqual(
      expect.arrayContaining(["gpt-6-luna", "gpt-5.4-mini"]),
    );
  });

  it("drops text.format and retries once on HTTP 400", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(b);
      if (bodies.length === 1) {
        return new Response('{"error":{"message":"unsupported text.format"}}', { status: 400 });
      }
      return respOk(JSON.stringify(payload));
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].text).toBeDefined();
    expect(bodies[1].text).toBeUndefined();
  });

  it("performs one repair re-ask when the reply fails Zod validation", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      // First reply parses as JSON but violates the schema.
      return respOk(JSON.stringify({ unexpected: "shape", insight: 42 }));
    }) as typeof fetch;

    const res = await callAI(opts());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("schema_invalid");
    expect(calls).toBe(2); // initial + one repair pass
  });

  it("supports ro and en language prompts end-to-end", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { input: string };
      seen.push(b.input);
      return respOk(JSON.stringify(payload));
    }) as typeof fetch;

    for (const lang of ["ro", "en"] as const) {
      const res = await callAI(opts(lang));
      expect(res.ok).toBe(true);
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('"lang":"ro"');
    expect(seen[1]).toContain('"lang":"en"');
  });
});
