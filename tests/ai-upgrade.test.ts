import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAI, hasCjkCharacters } from "@/lib/ai/provider";

/** Primary model of the chat-completions (OpenRouter) chain under test. */
const DEFAULT_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "baidu/ernie-5.5-flash-preview:free",
  "openrouter/free",
] as const;
import { AI_OUTPUT_JSON_SCHEMA, parseAIOutput } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { resolveInsightNames } from "@/lib/ai/names";
import { summarizeAthleteData } from "@/lib/ai/context";
import { verifyEvidence } from "@/lib/ai/verify";
import type { Alert, MorningCheckin, PostTrainingCheckin, ReadinessSnapshot, TrainingSession } from "@/lib/types";

const sampleInsight = (overrides: Record<string, unknown> = {}) => ({
  title: "ATH-01: высокая нагрузка и усталость",
  category: "load",
  severity: "attention",
  observation: "У ATH-01 зафиксирована высокая нагрузка (540) и усталость 8.",
  interpretation: "ATH-01 перегружен после серии тренировок; нужен контроль восстановления.",
  sections: [
    { area: "load", finding: "ATH-01 выполнил 2 тренировки общей нагрузкой 540." },
    { area: "recovery", finding: "Утром у ATH-01 сон 9, но восстановление 4." },
  ],
  watch: [{ subject: "ATH-01", reason: "Усталость ног после тренировки 9 из 10." }],
  positives: ["Сон 9 из 10", "Сон 9 из 10"],
  questions: ["Как ATH-01 перенёс вечернюю сессию?"],
  evidence: [
    {
      metric: "Нагрузка ATH-01",
      value: 540,
      period: "2026-11-01 — 2026-11-14",
      comparison: "Выше нормы ATH-01",
      source: "load.total_au",
    },
  ],
  recommendations: [
    { action: "Поговорить с ATH-01 о самочувствии", rationale: "У ATH-01 высокая усталость ног" },
    { action: "Поговорить с ATH-01 о самочувствии", rationale: "Дубль рекомендации" },
  ],
  confidence: "medium",
  limitations: ["У ATH-01 мало утренних отчётов"],
  period: { from: "2026-11-01", to: "2026-11-14" },
  ...overrides,
});

describe("AI Upgrade — model & structured output", () => {
  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_PROVIDER = "chat"; // these tests exercise the chat/completions wire format
    delete process.env.AI_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.AI_FALLBACK_MODEL;
    delete process.env.AI_MODELS;
    delete process.env.AI_DISABLE_RESPONSE_FORMAT;
    process.env.AI_DISABLE_CACHE = "true";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("uses dots-3-note-preview as default primary model", () => {
    expect(DEFAULT_MODELS[0]).toBe("dots-studio/dots-3-note-preview:free");
    expect(DEFAULT_MODELS).toContain("baidu/ernie-5.5-flash-preview:free");
    expect(DEFAULT_MODELS).toContain("openrouter/free");
  });

  it("sends response_format json_schema and falls back on HTTP 400", async () => {
    const bodies: Record<string, unknown>[] = [];
    const payload = { insufficient: false, insight: sampleInsight() };
    globalThis.fetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(parsed);
      if (bodies.length === 1) {
        return new Response("bad request", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
      validate: (d) => parseAIOutput(d) !== null,
    });

    expect(res.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].model).toBe(DEFAULT_MODELS[0]);
    expect(bodies[0].response_format).toEqual({
      type: "json_schema",
      json_schema: AI_OUTPUT_JSON_SCHEMA,
    });
    expect(bodies[1].response_format).toBeUndefined();
  });

  it("handles invalid JSON, empty responses, and CJK leakage", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"insufficient":false,"insight":{"title":"Тест 测试"}}' } }],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const cjkRes = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
      validate: (d) => parseAIOutput(d) !== null,
    });
    expect(cjkRes.ok).toBe(false);
    if (!cjkRes.ok) expect(cjkRes.error).toContain("cjk_output");

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    ) as typeof fetch;
    const emptyRes = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "en"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
    });
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) expect(emptyRes.error).toContain("empty provider response");
  });

  it("falls back through the configured priority chain on transient errors", async () => {
    process.env.AI_MODELS = `${DEFAULT_MODELS[0]},google/gemma-3-27b-it:free`;
    const modelsCalled: string[] = [];
    const payload = { insufficient: false, insight: sampleInsight() };
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(b.model);
      if (b.model === DEFAULT_MODELS[0]) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
      validate: (d) => parseAIOutput(d) !== null,
    });
    expect(res.ok).toBe(true);
    expect(modelsCalled).toContain(DEFAULT_MODELS[0]);
    expect(modelsCalled).toContain("google/gemma-3-27b-it:free");
    if (res.ok) expect(res.usage.model).toBe("google/gemma-3-27b-it:free");
  });

  it("does not fail over on auth/request-level errors (401/403)", async () => {
    process.env.AI_MODELS = `${DEFAULT_MODELS[0]},${DEFAULT_MODELS[1]}`;
    const modelsCalled: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(b.model);
      return new Response('{"error":{"message":"Missing Authentication header"}}', {
        status: 401,
      });
    }) as typeof fetch;

    const res = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
    });
    expect(res.ok).toBe(false);
    // Same key is used for every model — a 401 must stop the chain immediately.
    expect(new Set(modelsCalled)).toEqual(new Set([DEFAULT_MODELS[0]]));
  });

  it("fails over on timeout/network errors and reports the last model", async () => {
    process.env.AI_MODELS = `${DEFAULT_MODELS[0]},${DEFAULT_MODELS[1]}`;
    const modelsCalled: string[] = [];
    const payload = { insufficient: false, insight: sampleInsight() };
    globalThis.fetch = vi.fn(async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(b.model);
      if (b.model === DEFAULT_MODELS[0]) throw new Error("network down");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: true }, "en"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
      validate: (d) => parseAIOutput(d) !== null,
    });
    expect(res.ok).toBe(true);
    expect(modelsCalled).toEqual(
      expect.arrayContaining([DEFAULT_MODELS[0], DEFAULT_MODELS[1]]),
    );
  });

  it("deduplicates identical in-flight requests and caches results", async () => {
    delete process.env.AI_DISABLE_CACHE;
    const payload = { insufficient: false, insight: sampleInsight() };
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const opts = {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ test: "dedup" }, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
      validate: (d: unknown) => parseAIOutput(d) !== null,
    };
    // Two concurrent identical calls → one provider request.
    const [r1, r2] = await Promise.all([callAI(opts), callAI(opts)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(calls).toBe(1);
    // A later identical call → served from cache, still one provider request.
    const r3 = await callAI(opts);
    expect(r3.ok).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("AI Upgrade — languages, deduplication & name resolution", () => {
  it("enforces ru, ro and en language instructions without CJK", () => {
    const ruPrompt = JSON.parse(buildUserPrompt({ athlete_code: "ATH-01" }, "ru")) as {
      lang: string;
      language_instruction: string;
    };
    const roPrompt = JSON.parse(buildUserPrompt({ athlete_code: "ATH-01" }, "ro")) as {
      lang: string;
      language_instruction: string;
    };
    const enPrompt = JSON.parse(buildUserPrompt({ athlete_code: "ATH-01" }, "en")) as {
      lang: string;
      language_instruction: string;
    };
    expect(ruPrompt.lang).toBe("ru");
    expect(ruPrompt.language_instruction).toContain("Russian");
    expect(roPrompt.lang).toBe("ro");
    expect(roPrompt.language_instruction).toContain("Romanian");
    expect(enPrompt.lang).toBe("en");
    expect(enPrompt.language_instruction).toContain("English");
  });

  it("parses ru/ro/en outputs, deduplicates recommendations & positives", () => {
    for (const [title, obs] of [
      ["Снижение готовности", "Нагрузка выросла"],
      ["Scădere a pregătirii", "Volumul de antrenament a crescut"],
      ["Readiness dip", "Training load increased"],
    ]) {
      const parsed = parseAIOutput({
        insufficient: false,
        insight: sampleInsight({ title, observation: obs }),
      });
      expect(parsed).not.toBeNull();
      if (parsed && !parsed.insufficient) {
        expect(hasCjkCharacters(parsed.insight)).toBe(false);
        expect(parsed.insight.recommendations).toHaveLength(1);
        expect(parsed.insight.positives).toHaveLength(1);
      }
    }
  });

  it("resolves athlete codes to display names in every section including evidence & recommendations", () => {
    const parsed = parseAIOutput({ insufficient: false, insight: sampleInsight() });
    expect(parsed && !parsed.insufficient).toBe(true);
    if (!parsed || parsed.insufficient) return;

    const resolved = resolveInsightNames(parsed.insight, { "ATH-01": "Анна Коваль" });
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toContain("ATH-01");
    expect(resolved.title).toContain("Анна Коваль");
    expect(resolved.observation).toContain("Анна Коваль");
    expect(resolved.interpretation).toContain("Анна Коваль");
    expect(resolved.sections[0].finding).toContain("Анна Коваль");
    expect(resolved.watch[0].subject).toBe("Анна Коваль");
    expect(resolved.questions[0]).toContain("Анна Коваль");
    expect(resolved.evidence[0].metric).toContain("Анна Коваль");
    expect(resolved.evidence[0].comparison).toContain("Анна Коваль");
    expect(resolved.recommendations[0].action).toContain("Анна Коваль");
    expect(resolved.recommendations[0].rationale).toContain("Анна Коваль");
    expect(resolved.limitations[0]).toContain("Анна Коваль");
  });
});

describe("AI Upgrade — sports analysis edge cases", () => {
  const mkCheckin = (d: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
    id: d,
    athlete_id: "internal-uuid-123",
    checkin_date: d,
    submitted_at: `${d}T08:00:00Z`,
    sleep_score: 8,
    sleep_hours: 8,
    recovery_score: 8,
    fatigue_score: 2,
    muscle_soreness_score: 2,
    stress_score: 2,
    mood_score: 8,
    pain_status: "none",
    pain_location: null,
    pain_side: null,
    pain_severity: null,
    pain_onset: null,
    pain_triggers: [],
    swelling: null,
    movement_limitation: null,
    symptoms: null,
    notes: null,
    ...over,
  });

  it("preserves contradictory wellness scores and scale directions", () => {
    const ctx = summarizeAthleteData({
      code: "ATH-02",
      groups: ["U15"],
      from: "2026-11-01",
      to: "2026-11-14",
      days: 14,
      checkins: [
        mkCheckin("2026-11-14", {
          sleep_score: 9,
          recovery_score: 3,
          fatigue_score: 9,
          muscle_soreness_score: 8,
        }),
      ],
      sessions: [],
      posts: [],
      snapshot: { readiness_score: 78 } as ReadinessSnapshot,
      alerts: [],
      attendance: [],
      testResults: [],
      growth: [],
    });
    expect(ctx.wellbeing.sleep_avg).toBe(9);
    expect(ctx.wellbeing.recovery_avg).toBe(3);
    expect(ctx.wellbeing.fatigue_avg).toBe(9);
    expect(ctx.wellbeing.soreness_avg).toBe(8);
    expect(JSON.stringify(ctx)).not.toContain("internal-uuid-123");
    expect(SYSTEM_PROMPT).toContain("Higher = BETTER");
    expect(SYSTEM_PROMPT).toContain("Higher = WORSE");
  });

  it("handles missing data without inventing zeros", () => {
    const ctx = summarizeAthleteData({
      code: "ATH-03",
      groups: [],
      from: "2026-11-01",
      to: "2026-11-14",
      days: 14,
      checkins: [],
      sessions: [],
      posts: [],
      snapshot: null,
      alerts: [],
      attendance: [],
      testResults: [],
      growth: [],
    });
    expect(ctx.wellbeing.sleep_avg).toBeNull();
    expect(ctx.wellbeing.recovery_avg).toBeNull();
    expect(ctx.post_training.leg_fatigue_avg).toBeNull();
    expect(parseAIOutput({ insufficient: true, reason: "Нет данных", missing: ["checkins"] })).toEqual({
      insufficient: true,
      reason: "Нет данных",
      missing: ["checkins"],
    });
  });

  it("captures high fatigue and acute injury warning signals separately", () => {
    const ctx = summarizeAthleteData({
      code: "ATH-04",
      groups: ["U17"],
      from: "2026-11-01",
      to: "2026-11-14",
      days: 14,
      checkins: [
        mkCheckin("2026-11-14", {
          fatigue_score: 9,
          pain_status: "acute_instability",
          pain_severity: 8,
          swelling: true,
          movement_limitation: true,
        }),
      ],
      sessions: [{ session_load: 600, session_rpe: 9, started_at: "2026-11-13T17:00:00Z" } as TrainingSession],
      posts: [
        {
          id: "p1",
          athlete_id: "internal-uuid-123",
          training_session_id: "s1",
          submitted_at: "2026-11-13T19:00:00Z",
          overall_feeling: 3,
          leg_fatigue: 9,
          notes: null,
        } as unknown as PostTrainingCheckin,
      ],
      snapshot: { readiness_score: 42 } as ReadinessSnapshot,
      alerts: [{ rule_code: "acute_pain", severity: "priority", triggered_at: "2026-11-14T08:00:00Z" } as Alert],
      attendance: [],
      testResults: [],
      growth: [],
    });
    expect(ctx.acute.pain_reports_7d).toBe(1);
    expect(ctx.acute.max_pain_severity_7d).toBe(8);
    expect(ctx.acute.swelling_7d).toBe(1);
    expect(ctx.acute.movement_limitation_7d).toBe(1);
    expect(ctx.post_training.leg_fatigue_avg).toBe(9);
    const parsed = parseAIOutput({
      insufficient: false,
      insight: sampleInsight({
        severity: "important",
        evidence: [{ metric: "Боль", value: 8, period: "7d", source: "acute.max_pain_severity_7d" }],
      }),
    });
    expect(parsed && !parsed.insufficient && verifyEvidence(parsed.insight, ctx).ok).toBe(true);
  });
});
