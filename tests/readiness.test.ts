import { describe, expect, it } from "vitest";
import {
  normalizeCheckin,
  readinessScore,
  computeBaseline,
  confidenceFor,
  buildSnapshot,
  dailyReadiness,
  dailyConditionSeries,
  postsByLocalDate,
  postWellnessScore,
  conditionScore,
  MORNING_WEIGHT,
  bandForScore,
  MIN_BASELINE_OBSERVATIONS,
  rollingNorm,
  rollingItemNorms,
  itemZScores,
  zScore,
  ROLLING_MIN_DAYS,
  SD_FLOOR_SCORE,
  SD_FLOOR_ITEM,
} from "@/lib/readiness";
import type { MorningCheckin, PostTrainingCheckin } from "@/lib/types";

const mkCheckin = (over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: "c1",
  athlete_id: "a1",
  checkin_date: "2026-10-20",
  submitted_at: "2026-10-20T07:00:00Z",
  sleep_score: 4,
  sleep_hours: null,
  recovery_score: 4,
  fatigue_score: 2,
  muscle_soreness_score: 1,
  stress_score: 2,
  mood_score: 4,
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

describe("normalizeCheckin", () => {
  it("keeps positive scales direct and inverts negative ones", () => {
    const n = normalizeCheckin(mkCheckin({ sleep_score: 10, fatigue_score: 10 }));
    expect(n.sleep).toBe(1); // best sleep -> 1
    expect(n.fatigue).toBe(0); // worst fatigue -> 0 (inverted)
  });

  it("maps mid-scale answers symmetrically around 0.5", () => {
    const n = normalizeCheckin(mkCheckin({ stress_score: 5, mood_score: 6 }));
    expect(n.stress).toBeCloseTo(5 / 9); // inv(5) = 5/9
    expect(n.mood).toBeCloseTo(5 / 9); // norm(6) = 5/9
  });
});

describe("readinessScore", () => {
  it("returns 100 for a perfect check-in", () => {
    const n = normalizeCheckin(
      mkCheckin({ sleep_score: 10, recovery_score: 10, fatigue_score: 1, muscle_soreness_score: 1, stress_score: 1, mood_score: 10 }),
    );
    expect(readinessScore(n)).toBe(100);
  });

  it("returns 0 for the worst possible check-in", () => {
    const n = normalizeCheckin(
      mkCheckin({ sleep_score: 1, recovery_score: 1, fatigue_score: 10, muscle_soreness_score: 10, stress_score: 10, mood_score: 1 }),
    );
    expect(readinessScore(n)).toBe(0);
  });
});

describe("computeBaseline", () => {
  it("refuses a baseline with too few observations", () => {
    expect(computeBaseline([70, 72, 68])).toBeNull();
    expect(computeBaseline(Array(MIN_BASELINE_OBSERVATIONS - 1).fill(70))).toBeNull();
  });

  it("computes mean/sd with enough data", () => {
    const b = computeBaseline(Array(MIN_BASELINE_OBSERVATIONS).fill(70));
    expect(b).not.toBeNull();
    expect(b!.avg).toBe(70);
    expect(b!.sd).toBe(0);
  });
});

describe("confidenceFor", () => {
  it("requires the minimum observation count", () => {
    expect(confidenceFor(7)).toBe("insufficient");
    expect(confidenceFor(MIN_BASELINE_OBSERVATIONS)).toBe("sufficient");
  });
});

describe("buildSnapshot", () => {
  it("flags scores far below baseline", () => {
    const history = Array(10).fill(80);
    const bad = mkCheckin({ sleep_score: 1, recovery_score: 1, fatigue_score: 10, muscle_soreness_score: 10, stress_score: 10, mood_score: 1 });
    const snap = buildSnapshot(bad, history);
    expect(snap.explanation.flags).toContain("below_personal_baseline");
    expect(snap.readiness_score).toBe(0);
  });

  it("does not flag normal variation", () => {
    const history = [70, 72, 68, 71, 69, 73, 70, 72];
    const ok = mkCheckin({
      sleep_score: 8, recovery_score: 8, fatigue_score: 3,
      muscle_soreness_score: 2, stress_score: 3, mood_score: 8,
    });
    const snap = buildSnapshot(ok, history);
    expect(snap.explanation.flags).not.toContain("below_personal_baseline");
    expect(snap.confidence).toBe("sufficient");
  });
});

describe("dailyReadiness / bandForScore", () => {
  it("produces one value per check-in date, sorted ascending", () => {
    const s = dailyReadiness([
      mkCheckin({ checkin_date: "2026-10-21" }),
      mkCheckin({ checkin_date: "2026-10-20" }),
    ]);
    expect(s.map((x) => x.date)).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("bands: >=70 good, >=45 moderate, else low", () => {
    expect(bandForScore(75)).toBe("good");
    expect(bandForScore(50)).toBe("moderate");
    expect(bandForScore(20)).toBe("low");
  });
});

const mkPost = (
  over: Partial<Pick<PostTrainingCheckin, "overall_feeling" | "leg_fatigue" | "arm_shoulder_fatigue" | "submitted_at">> = {},
): Pick<PostTrainingCheckin, "overall_feeling" | "leg_fatigue" | "arm_shoulder_fatigue" | "submitted_at"> => ({
  submitted_at: "2026-10-20T19:00:00Z",
  overall_feeling: 4,
  leg_fatigue: 2,
  arm_shoulder_fatigue: 2,
  ...over,
});

describe("postWellnessScore", () => {
  it("returns 100 for a perfect evening check-in and 0 for the worst", () => {
    expect(postWellnessScore(mkPost({ overall_feeling: 10, leg_fatigue: 1, arm_shoulder_fatigue: 1 }))).toBe(100);
    expect(postWellnessScore(mkPost({ overall_feeling: 1, leg_fatigue: 10, arm_shoulder_fatigue: 10 }))).toBe(0);
  });

  it("maps mid-scale answers to ~56", () => {
    // norm(6) = inv(5) = 5/9 -> 55.6
    expect(postWellnessScore(mkPost({ overall_feeling: 6, leg_fatigue: 5, arm_shoulder_fatigue: 5 }))).toBeCloseTo(55.56);
  });
});

describe("conditionScore", () => {
  it("equals the morning score when no post check-in exists", () => {
    const c = mkCheckin();
    expect(conditionScore(c, null)).toBe(conditionScore(c));
  });

  it("blends 70/30 morning/evening", () => {
    const morning = mkCheckin({
      sleep_score: 10, recovery_score: 10, fatigue_score: 1,
      muscle_soreness_score: 1, stress_score: 1, mood_score: 10,
    }); // morning = 100
    const post = mkPost({ overall_feeling: 1, leg_fatigue: 10, arm_shoulder_fatigue: 10 }); // evening = 0
    expect(conditionScore(morning, post)).toBe(100 * MORNING_WEIGHT);
  });
});

describe("dailyConditionSeries", () => {
  it("blends only the days that have a post check-in", () => {
    const series = dailyConditionSeries(
      [mkCheckin({ checkin_date: "2026-10-20" }), mkCheckin({ checkin_date: "2026-10-21" })],
      [{ date: "2026-10-20", post: mkPost() }],
    );
    expect(series).toHaveLength(2);
    expect(series[0].score).not.toBe(series[1].score);
    expect(series[1].score).toBe(conditionScore(mkCheckin({ checkin_date: "2026-10-21" })));
  });
});

describe("rollingNorm / zScore", () => {
  it("refuses a norm with too few days", () => {
    expect(rollingNorm(Array(ROLLING_MIN_DAYS - 1).fill(70), SD_FLOOR_SCORE)).toBeNull();
  });

  it("computes mean/sd and applies the SD floor", () => {
    const n = rollingNorm([60, 70, 80, 60, 70, 80, 60, 70, 80, 65, 75, 70], SD_FLOOR_SCORE);
    expect(n!.days).toBe(12);
    expect(n!.sd).toBeGreaterThan(0);
    const flat = rollingNorm(Array(ROLLING_MIN_DAYS).fill(70), SD_FLOOR_SCORE);
    expect(flat!.sd).toBe(SD_FLOOR_SCORE); // floor kicks in on zero variance
  });

  it("z = (value - avg) / sd, negative below the norm", () => {
    const norm = { avg: 70, sd: 5, days: 20 };
    expect(zScore(60, norm)).toBe(-2);
    expect(zScore(75, norm)).toBe(1);
    expect(zScore(60, null)).toBeNull();
  });
});

describe("rollingItemNorms / itemZScores", () => {
  it("builds per-item norms and flags a below-norm item", () => {
    const past = Array.from({ length: 12 }, () => mkCheckin({ sleep_score: 8 }));
    const norms = rollingItemNorms(past);
    expect(norms.sleep_score!.avg).toBe(8);
    expect(norms.sleep_score!.sd).toBe(SD_FLOOR_ITEM);
    const today = mkCheckin({ sleep_score: 6 });
    const z = itemZScores(today, norms);
    expect(z.sleep_score).toBe(-4); // (6-8)/0.5
  });
});

describe("postsByLocalDate", () => {
  it("buckets by local date and keeps the latest submission per day", () => {
    const entries = postsByLocalDate(
      [
        mkPost({ submitted_at: "2026-10-20T08:00:00Z", overall_feeling: 1 }),
        mkPost({ submitted_at: "2026-10-20T10:00:00Z", overall_feeling: 10 }),
        mkPost({ submitted_at: "2026-10-21T08:00:00Z" }),
      ],
      "Europe/Chisinau",
    );
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.date === "2026-10-20")!.post.overall_feeling).toBe(10);
  });
});
