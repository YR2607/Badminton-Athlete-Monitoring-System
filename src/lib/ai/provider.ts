/**
 * Server-only OpenAI Responses API adapter.
 * No SDK dependency — plain fetch keeps the bundle and supply chain small.
 * The API key never leaves the server: this module must only be imported
 * from server components, server actions and route handlers.
 */

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export type AIResult =
  | { ok: true; data: unknown; usage: AIUsage }
  | { ok: false; error: string; usage?: AIUsage };

const ENDPOINT = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 30_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function callAI(opts: {
  system: string;
  user: string;
  jsonSchema: { name: string; strict: boolean; schema: unknown };
  model?: string;
  maxOutputTokens?: number;
}): Promise<AIResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY not configured" };
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const body = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: opts.system }] },
      { role: "user", content: [{ type: "input_text", text: opts.user }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: opts.jsonSchema.name,
        strict: opts.jsonSchema.strict,
        schema: opts.jsonSchema.schema,
      },
    },
    max_output_tokens: opts.maxOutputTokens ?? 1200,
    store: false,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        if (attempt === 0 && RETRYABLE.has(res.status)) continue;
        return { ok: false, error: `provider ${res.status}` };
      }
      const json = (await res.json()) as {
        output?: { type: string; content?: { type: string; text?: string }[] }[];
        output_text?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const usage: AIUsage = {
        input_tokens: json.usage?.input_tokens ?? 0,
        output_tokens: json.usage?.output_tokens ?? 0,
        model,
      };
      const text =
        json.output_text ??
        json.output
          ?.find((o) => o.type === "message")
          ?.content?.find((c) => c.type === "output_text")?.text;
      if (!text) return { ok: false, error: "empty provider response", usage };
      try {
        return { ok: true, data: JSON.parse(text), usage };
      } catch {
        return { ok: false, error: "provider returned invalid JSON", usage };
      }
    } catch {
      if (attempt === 0) continue;
      return { ok: false, error: "provider timeout/network error" };
    }
  }
  return { ok: false, error: "unreachable" };
}
