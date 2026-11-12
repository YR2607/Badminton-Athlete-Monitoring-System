import { z } from "zod";

/** Structured output contract for the AI interpretation layer. */

export const EvidenceItem = z.object({
  metric: z.string(),
  value: z.union([z.number(), z.string()]),
  period: z.string(),
  comparison: z.string().optional(),
  source: z.string(),
});

export const RecommendationItem = z.object({
  action: z.string(),
  rationale: z.string(),
});

/** Per-domain finding — one entry per area that has data. */
export const SectionItem = z.object({
  area: z.string(),
  finding: z.string(),
});

/** Something to monitor — athlete_code (group) or aspect (athlete). */
export const WatchItem = z.object({
  subject: z.string(),
  reason: z.string(),
});

export const InsightCategory = z.enum([
  "readiness",
  "load",
  "recovery",
  "attendance",
  "data_quality",
  "team",
  "strategy",
  "development",
]);

export const InsightSeverity = z.enum(["info", "attention", "important"]);

export const Confidence = z.enum(["low", "medium", "high"]);

export const AIInsight = z.object({
  title: z.string().max(200),
  category: InsightCategory,
  severity: InsightSeverity,
  observation: z.string(),
  interpretation: z.string(),
  sections: z.array(SectionItem).max(8),
  watch: z.array(WatchItem).max(8),
  positives: z.array(z.string()).max(5),
  questions: z.array(z.string()).max(5),
  evidence: z.array(EvidenceItem),
  recommendations: z.array(RecommendationItem).max(5),
  confidence: Confidence,
  limitations: z.array(z.string()),
  period: z.object({ from: z.string(), to: z.string() }),
});

/** Explicit non-answer when data is insufficient — never invent conclusions. */
export const AIInsufficient = z.object({
  insufficient: z.literal(true),
  reason: z.string(),
  missing: z.array(z.string()),
});

export const AIOutput = z.union([
  z.object({ insufficient: z.literal(false), insight: AIInsight }),
  AIInsufficient,
]);

export type EvidenceItem = z.infer<typeof EvidenceItem>;
export type SectionItem = z.infer<typeof SectionItem>;
export type WatchItem = z.infer<typeof WatchItem>;
export type AIInsight = z.infer<typeof AIInsight>;
export type AIInsufficient = z.infer<typeof AIInsufficient>;
export type AIOutput = z.infer<typeof AIOutput>;
export type InsightCategory = z.infer<typeof InsightCategory>;
export type InsightSeverity = z.infer<typeof InsightSeverity>;

/** JSON Schema handed to the provider for strict structured output. */
export const AI_OUTPUT_JSON_SCHEMA = {
  name: "ai_insight",
  strict: true,
  schema: {
    type: "object",
    properties: {
      insufficient: { type: "boolean" },
      reason: { type: "string" },
      missing: { type: "array", items: { type: "string" } },
      insight: {
        type: ["object", "null"],
        properties: {
          title: { type: "string" },
          category: {
            type: "string",
            enum: [
              "readiness",
              "load",
              "recovery",
              "attendance",
              "data_quality",
              "team",
              "strategy",
              "development",
            ],
          },
          severity: { type: "string", enum: ["info", "attention", "important"] },
          observation: { type: "string" },
          interpretation: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metric: { type: "string" },
                value: { type: ["number", "string"] },
                period: { type: "string" },
                comparison: { type: "string" },
                source: { type: "string" },
              },
              required: ["metric", "value", "period", "source"],
              additionalProperties: false,
            },
          },
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                rationale: { type: "string" },
              },
              required: ["action", "rationale"],
              additionalProperties: false,
            },
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                area: { type: "string" },
                finding: { type: "string" },
              },
              required: ["area", "finding"],
              additionalProperties: false,
            },
          },
          watch: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subject: { type: "string" },
                reason: { type: "string" },
              },
              required: ["subject", "reason"],
              additionalProperties: false,
            },
          },
          positives: { type: "array", items: { type: "string" } },
          questions: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          limitations: { type: "array", items: { type: "string" } },
          period: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
            },
            required: ["from", "to"],
            additionalProperties: false,
          },
        },
        required: [
          "title",
          "category",
          "severity",
          "observation",
          "interpretation",
          "sections",
          "watch",
          "positives",
          "questions",
          "evidence",
          "recommendations",
          "confidence",
          "limitations",
          "period",
        ],
        additionalProperties: false,
      },
    },
    required: ["insufficient"],
    additionalProperties: false,
  },
} as const;

/** True when an object plausibly IS an AIInsight without its wrapper. */
function looksLikeInsight(o: Record<string, unknown>): boolean {
  return (
    typeof o.observation === "string" ||
    typeof o.interpretation === "string" ||
    (typeof o.title === "string" && Array.isArray(o.evidence))
  );
}

/**
 * Parse provider JSON into the union. Tolerates `insight: null`, bare
 * insight objects, string booleans and extra wrappers ({result: {...}},
 * top-level arrays) — free models drop the required shape regularly.
 */
export function parseAIOutput(raw: unknown): AIOutput | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const r = parseAIOutput(item);
        if (r) return r;
      }
    }
    return null;
  }
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return null;
  if (obj.insufficient === true || obj.insufficient === "true") {
    const r = AIInsufficient.safeParse({
      insufficient: true,
      reason: typeof obj.reason === "string" ? obj.reason : "insufficient data",
      missing: Array.isArray(obj.missing) ? obj.missing.filter((x) => typeof x === "string") : [],
    });
    return r.success ? r.data : null;
  }
  const candidates: Record<string, unknown>[] = [];
  if (obj.insight && typeof obj.insight === "object")
    candidates.push(obj.insight as Record<string, unknown>);
  if (looksLikeInsight(obj)) candidates.push(obj);
  for (const c of candidates) {
    const r = AIInsight.safeParse(sanitizeInsight(c));
    if (r.success) return { insufficient: false, insight: r.data };
  }
  // Loose wrappers: scan nested objects ({result: {...}}, {data: [...]}).
  for (const v of Object.values(obj)) {
    if (!v || typeof v !== "object") continue;
    const nested = parseAIOutput(v);
    if (nested) return nested;
  }
  return null;
}

const okEnum = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Coerce loose model output into a valid AIInsight candidate. */
export function sanitizeInsight(obj: Record<string, unknown>) {
  const evidence = (Array.isArray(obj.evidence) ? obj.evidence : [])
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
    .filter((e): e is Record<string, unknown> => e !== null)
    .map((e) => ({
      metric: typeof e.metric === "string" ? e.metric : "metric",
      value:
        typeof e.value === "number" || typeof e.value === "string"
          ? e.value
          : String(e.value ?? ""),
      period: typeof e.period === "string" ? e.period : "period",
      comparison: typeof e.comparison === "string" ? e.comparison : undefined,
      source: typeof e.source === "string" ? e.source : "context",
    }))
    .slice(0, 10);
  const recommendations = (Array.isArray(obj.recommendations) ? obj.recommendations : [])
    .map((r) => {
      if (typeof r === "string") return { action: r, rationale: "" };
      if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        return {
          action: typeof o.action === "string" ? o.action : String(o.action ?? ""),
          rationale: typeof o.rationale === "string" ? o.rationale : String(o.rationale ?? ""),
        };
      }
      return null;
    })
    .filter((r): r is { action: string; rationale: string } => r !== null && r.action.length > 0)
    .slice(0, 5);
  const sections = (Array.isArray(obj.sections) ? obj.sections : [])
    .map((s) => {
      if (typeof s === "string") return { area: "general", finding: s };
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        return {
          area: typeof o.area === "string" ? o.area : "general",
          finding: typeof o.finding === "string" ? o.finding : String(o.finding ?? o.note ?? ""),
        };
      }
      return null;
    })
    .filter((s): s is { area: string; finding: string } => s !== null && s.finding.length > 0)
    .slice(0, 8);
  const watch = (Array.isArray(obj.watch) ? obj.watch : [])
    .map((w) => {
      if (typeof w === "string") return { subject: w, reason: "" };
      if (w && typeof w === "object") {
        const o = w as Record<string, unknown>;
        return {
          subject:
            typeof o.subject === "string" ? o.subject : String(o.subject ?? o.athlete ?? ""),
          reason: typeof o.reason === "string" ? o.reason : String(o.reason ?? o.why ?? ""),
        };
      }
      return null;
    })
    .filter((w): w is { subject: string; reason: string } => w !== null && w.subject.length > 0)
    .slice(0, 8);
  const p = obj.period && typeof obj.period === "object" ? (obj.period as Record<string, unknown>) : {};
  return {
    title: typeof obj.title === "string" ? obj.title.slice(0, 200) : "AI analysis",
    category: okEnum(obj.category, InsightCategory.options, "readiness"),
    severity: okEnum(obj.severity, InsightSeverity.options, "info"),
    observation: typeof obj.observation === "string" ? obj.observation : "",
    interpretation:
      typeof obj.interpretation === "string"
        ? obj.interpretation
        : typeof obj.analysis === "string"
          ? obj.analysis
          : "",
    sections,
    watch,
    positives: asStringArray(obj.positives).slice(0, 5),
    questions: asStringArray(obj.questions).slice(0, 5),
    evidence,
    recommendations,
    confidence: okEnum(obj.confidence, Confidence.options, "low"),
    limitations: asStringArray(obj.limitations),
    period: {
      from: typeof p.from === "string" ? p.from : "",
      to: typeof p.to === "string" ? p.to : "",
    },
  };
}
