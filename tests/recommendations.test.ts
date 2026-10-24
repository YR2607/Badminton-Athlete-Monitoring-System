import { describe, expect, it } from "vitest";
import { evaluateRecommendations, type RecInput } from "@/lib/recommendations";

const base: RecInput = {
  z: 0,
  acwr: 1.0,
  itemZ: null,
  acutePain: false,
};

const key = (in_: RecInput) => evaluateRecommendations(in_)[0]?.rule_key;

describe("evaluateRecommendations", () => {
  it("medical overrides everything when acute pain is present", () => {
    expect(key({ ...base, acutePain: true, z: -3, acwr: 2 })).toBe("rest_medical");
    expect(key({ ...base, ostrcSubstantial: true })).toBe("rest_medical");
  });

  it("growth spurt band 88–95% triggers the jump-restriction rule", () => {
    expect(key({ ...base, growthPct: 90 })).toBe("growth_spurt");
    expect(key({ ...base, growthPct: 96 })).not.toBe("growth_spurt");
  });

  it("reduce_load: low z + high ACWR + physical items dipped", () => {
    const itemZ = {
      sleep_score: -1.4,
      recovery_score: -1.2,
      fatigue_score: 1.3,
      muscle_soreness_score: 1.1,
      stress_score: 0,
      mood_score: -0.4,
    };
    expect(key({ ...base, z: -1.4, acwr: 1.6, itemZ })).toBe("reduce_load");
  });

  it("no reduce_load when the dip is only psychological", () => {
    const itemZ = {
      sleep_score: 0,
      recovery_score: 0,
      fatigue_score: 0,
      muscle_soreness_score: 0,
      stress_score: 1.4,
      mood_score: -1.3,
    };
    expect(key({ ...base, z: -1.4, acwr: 1.6, itemZ })).not.toBe("reduce_load");
  });

  it("talk: low z, normal load, only stress/mood dipped", () => {
    const itemZ = {
      sleep_score: 0.1,
      recovery_score: 0,
      fatigue_score: 0.2,
      muscle_soreness_score: 0,
      stress_score: 1.3,
      mood_score: -1.2,
    };
    expect(key({ ...base, z: -1.3, acwr: 1.0, itemZ })).toBe("talk");
  });

  it("increase_load: fine z but chronic underload (ACWR < 0.8)", () => {
    expect(key({ ...base, z: 0.2, acwr: 0.7 })).toBe("increase_load");
  });

  it("plan_ok: fine z and ACWR in the sweet spot", () => {
    expect(key({ ...base, z: -0.5, acwr: 1.1 })).toBe("plan_ok");
    expect(key({ ...base, z: 0.3, acwr: null })).toBe("plan_ok");
  });

  it("nothing without a formed norm (z = null)", () => {
    expect(evaluateRecommendations({ ...base, z: null })).toEqual([]);
  });
});
