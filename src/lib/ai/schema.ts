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
    const r = AIInsufficient.safeParse(obj);
    return r.success ? r.data : null;
  }
  if (obj.insight && typeof obj.insight === "object") {
    const r = AIInsight.safeParse(obj.insight);
    return r.success ? { insufficient: false, insight: r.data } : null;
  }
  // Tolerate bare insight objects — some models drop the wrapper.
  if (typeof obj.observation === "string" && typeof obj.interpretation === "string") {
    const r = AIInsight.safeParse({
      title: obj.title ?? "AI analysis",
      category: obj.category ?? "readiness",
      severity: obj.severity ?? "info",
      observation: obj.observation,
      interpretation: obj.interpretation,
      evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
      recommendations: Array.isArray(obj.recommendations) ? obj.recommendations : [],
      confidence: obj.confidence ?? "low",
      limitations: Array.isArray(obj.limitations) ? obj.limitations : [],
      period: obj.period && typeof obj.period === "object" ? obj.period : { from: "", to: "" },
    });
    if (r.success) return { insufficient: false, insight: r.data };
  }
  return null;
}
