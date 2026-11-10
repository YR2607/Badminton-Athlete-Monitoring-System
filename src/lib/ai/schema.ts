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

/** Parse provider JSON into the union, tolerating `insight: null`. */
export function parseAIOutput(raw: unknown): AIOutput | null {
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return null;
  if (obj.insufficient === true) {
    const r = AIInsufficient.safeParse({
      insufficient: true,
      reason: typeof obj.reason === "string" ? obj.reason : "insufficient data",
      missing: Array.isArray(obj.missing) ? obj.missing.filter((x) => typeof x === "string") : [],
    });
    return r.success ? r.data : null;
  }
  if (obj.insight && typeof obj.insight === "object") {
    const r = AIInsight.safeParse(sanitizeInsight(obj.insight as Record<string, unknown>));
    return r.success ? { insufficient: false, insight: r.data } : null;
  }
  // Tolerate bare insight objects — some models drop the wrapper.
  if (typeof obj.observation === "string" && typeof obj.interpretation === "string") {
    const r = AIInsight.safeParse(sanitizeInsight(obj));
    if (r.success) return { insufficient: false, insight: r.data };
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
  const p = obj.period && typeof obj.period === "object" ? (obj.period as Record<string, unknown>) : {};
  return {
    title: typeof obj.title === "string" ? obj.title.slice(0, 200) : "AI analysis",
    category: okEnum(obj.category, InsightCategory.options, "readiness"),
    severity: okEnum(obj.severity, InsightSeverity.options, "info"),
    observation: String(obj.observation),
    interpretation: String(obj.interpretation),
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
