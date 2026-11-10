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
    expect(
      parseAIOutput({ insufficient: false, insight: { ...validInsight, category: "diagnosis" } }),
    ).toBeNull();
    expect(
      parseAIOutput({ insufficient: false, insight: { ...validInsight, evidence: "n/a" } }),
    ).toBeNull();
  });

  it("caps recommendation count via schema", () => {
    const many = { ...validInsight, recommendations: Array(6).fill(validInsight.recommendations[0]) };
    expect(AIInsight.safeParse(many).success).toBe(false);
  });
});
