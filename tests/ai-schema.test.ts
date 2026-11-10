import { describe, expect, it } from "vitest";
import { parseAIOutput, AIInsight } from "@/lib/ai/schema";

const validInsight = {
  title: "Spike in training load",
  category: "load",
  severity: "attention",
  observation: "Load rose sharply",
  interpretation: "May need a lighter day",
  evidence: [{ metric: "total_au", value: 420, period: "14d", source: "load.total_au" }],
  recommendations: [{ action: "Plan an easy day", rationale: "Peak without recovery" }],
  confidence: "medium",
  limitations: ["Short window"],
  period: { from: "2026-10-26", to: "2026-11-08" },
};

describe("parseAIOutput", () => {
  it("accepts a valid insight payload", () => {
    const r = parseAIOutput({ insufficient: false, insight: validInsight });
    expect(r).not.toBeNull();
    expect(r && !r.insufficient && r.insight.title).toBe("Spike in training load");
  });

  it("accepts explicit insufficient-data result", () => {
    const r = parseAIOutput({ insufficient: true, reason: "few check-ins", missing: ["checkins"] });
    expect(r).toEqual({ insufficient: true, reason: "few check-ins", missing: ["checkins"] });
  });

  it("rejects malformed payloads", () => {
    expect(parseAIOutput(null)).toBeNull();
    expect(parseAIOutput("text")).toBeNull();
    expect(parseAIOutput({})).toBeNull();
    expect(parseAIOutput({ insufficient: false })).toBeNull();
    expect(parseAIOutput({ insufficient: true })).toBeNull();
    // Unknown enum values are coerced to safe defaults, not rejected.
    const coerced = parseAIOutput({
      insufficient: false,
      insight: { ...validInsight, category: "diagnosis" },
    });
    expect(coerced && !coerced.insufficient && coerced.insight.category).toBe("readiness");
    // Malformed evidence is dropped to [] by the sanitizer, not fatal.
    const sanitized = parseAIOutput({
      insufficient: false,
      insight: { ...validInsight, evidence: "n/a" },
    });
    expect(sanitized && !sanitized.insufficient && sanitized.insight.evidence).toEqual([]);
  });

  it("caps recommendation count via schema", () => {
    const many = { ...validInsight, recommendations: Array(6).fill(validInsight.recommendations[0]) };
    expect(AIInsight.safeParse(many).success).toBe(false);
  });
});

describe("bare insight tolerance", () => {
  it("wraps a wrapper-less insight object", () => {
    const r = parseAIOutput({
      observation: "Load rose",
      interpretation: "May need lighter day",
      title: "Spike",
      evidence: [{ metric: "total_au", value: 420, period: "14d", source: "load" }],
    });
    expect(r && !r.insufficient && r.insight.observation).toBe("Load rose");
    expect(r && !r.insufficient && r.insight.confidence).toBe("low");
  });
});
