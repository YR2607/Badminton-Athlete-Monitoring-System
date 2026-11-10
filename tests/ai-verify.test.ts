import { describe, expect, it } from "vitest";
import { verifyEvidence, contextNumbers } from "@/lib/ai/verify";
import type { AIInsight } from "@/lib/ai/schema";

const context = {
  athlete_code: "AT-07",
  readiness: { latest_score: 68, baseline_avg: 74.2, z_score: -1.1 },
  load: { sessions: 9, total_au: 420.5 },
  alerts_open: [{ rule_code: "low_readiness", severity: "priority", triggered_at: "2026-11-07" }],
};

const insight = (value: number | string): AIInsight => ({
  title: "t",
  category: "load",
  severity: "info",
  observation: "o",
  interpretation: "i",
  evidence: [{ metric: "total_au", value, period: "14d", source: "load" }],
  recommendations: [],
  confidence: "low",
  limitations: [],
  period: { from: "a", to: "b" },
});

describe("verifyEvidence", () => {
  it("passes when every numeric claim exists in context", () => {
    expect(verifyEvidence(insight(420.5), context).ok).toBe(true);
    expect(verifyEvidence(insight(68), context).ok).toBe(true);
    expect(verifyEvidence(insight(9), context).ok).toBe(true);
  });

  it("accepts near-matches within rounding tolerance", () => {
    expect(verifyEvidence(insight(74.4), context).ok).toBe(true); // baseline 74.2 ±0.51? no — 0.2
    expect(verifyEvidence(insight(420), context).ok).toBe(true); // 420.5 rounds to 420
  });

  it("rejects invented numbers", () => {
    const r = verifyEvidence(insight(999), context);
    expect(r.ok).toBe(false);
    expect(r.unverified[0]).toEqual({ metric: "total_au", value: 999 });
  });

  it("ignores string evidence values (dates, labels)", () => {
    expect(verifyEvidence(insight("2026-11-07"), context).ok).toBe(true);
  });

  it("collectNumbers walks nested objects", () => {
    const s = contextNumbers({ a: { b: [{ c: 7.34 }] } });
    expect(s.has(7.3)).toBe(true);
    expect(s.has(7)).toBe(true);
  });
});
