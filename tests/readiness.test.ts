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
} from "@/lib/readiness";
import type { MorningCheckin, PostTrainingCheckin } from "@/lib/types";

const mkCheckin = (over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: "c1",
  athlete_id: "a1",
  checkin_date: "2026-10-20",
  submitted_at: "2026-10-20T07:00:00Z",
  sleep_score: 4,
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
    const n = normalizeCheckin(mkCheckin({ sleep_score: 5, fatigue_score: 5 }));
    expect(n.sleep).toBe(1); // best sleep -> 1
    expect(n.fatigue).toBe(0); // worst fatigue -> 0 (inverted)
  });

  it("maps middle value 3 to 0.5", () => {
    const n = normalizeCheckin(mkCheckin({ stress_score: 3, mood_score: 3 }));
    expect(n.stress).toBeCloseTo(0.5);
    expect(n.mood).toBeCloseTo(0.5);
  });
});

describe("readinessScore", () => {
  it("returns 100 for a perfect check-in", () => {
    const n = normalizeCheckin(
      mkCheckin({ sleep_score: 5, recovery_score: 5, fatigue_score: 1, muscle_soreness_score: 1, stress_score: 1, mood_score: 5 }),
    );
    expect(readinessScore(n)).toBe(100);
  });

  it("returns 0 for the worst possible check-in", () => {
    const n = normalizeCheckin(
      mkCheckin({ sleep_score: 1, recovery_score: 1, fatigue_score: 5, muscle_soreness_score: 5, stress_score: 5, mood_score: 1 }),
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
    const bad = mkCheckin({ sleep_score: 1, recovery_score: 1, fatigue_score: 5, muscle_soreness_score: 5, stress_score: 5, mood_score: 1 });
    const snap = buildSnapshot(bad, history);
    expect(snap.explanation.flags).toContain("below_personal_baseline");
    expect(snap.readiness_score).toBe(0);
  });

  it("does not flag normal variation", () => {
    const history = [70, 72, 68, 71, 69, 73, 70, 72];
    const ok = mkCheckin();
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
    expect(postWellnessScore(mkPost({ overall_feeling: 5, leg_fatigue: 1, arm_shoulder_fatigue: 1 }))).toBe(100);
    expect(postWellnessScore(mkPost({ overall_feeling: 1, leg_fatigue: 5, arm_shoulder_fatigue: 5 }))).toBe(0);
  });

  it("maps neutral answers to 50", () => {
    expect(postWellnessScore(mkPost({ overall_feeling: 3, leg_fatigue: 3, arm_shoulder_fatigue: 3 }))).toBe(50);
  });
});

describe("conditionScore", () => {
  it("equals the morning score when no post check-in exists", () => {
    const c = mkCheckin();
    expect(conditionScore(c, null)).toBe(conditionScore(c));
  });

  it("blends 70/30 morning/evening", () => {
    const morning = mkCheckin({
      sleep_score: 5, recovery_score: 5, fatigue_score: 1,
      muscle_soreness_score: 1, stress_score: 1, mood_score: 5,
    }); // morning = 100
    const post = mkPost({ overall_feeling: 1, leg_fatigue: 5, arm_shoulder_fatigue: 5 }); // evening = 0
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

describe("postsByLocalDate", () => {
  it("buckets by local date and keeps the latest submission per day", () => {
    const entries = postsByLocalDate(
      [
        mkPost({ submitted_at: "2026-10-20T08:00:00Z", overall_feeling: 1 }),
        mkPost({ submitted_at: "2026-10-20T10:00:00Z", overall_feeling: 5 }),
        mkPost({ submitted_at: "2026-10-21T08:00:00Z" }),
      ],
      "Europe/Chisinau",
    );
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.date === "2026-10-20")!.post.overall_feeling).toBe(5);
  });
});
