import { describe, expect, it } from "vitest";
import { evaluateAlerts, type EvalContext } from "@/lib/alerts";
import { computeBaseline, buildSnapshot } from "@/lib/readiness";
import type { AlertRule, MorningCheckin, PostTrainingCheckin } from "@/lib/types";

const RULES: AlertRule[] = [
  { id: "1", code: "acute_pain", severity: "priority", enabled: true, params: { pain_statuses: ["acute_instability"], swelling: true, movement_limitation: true, min_severity: 7 }, description: "", version: 1 },
  { id: "2", code: "illness_symptoms", severity: "priority", enabled: true, params: {}, description: "", version: 1 },
  { id: "3", code: "joint_pain", severity: "review_load", enabled: true, params: { pain_statuses: ["joint_tendon"], min_severity: 5 }, description: "", version: 1 },
  { id: "4", code: "readiness_drop", severity: "attention", enabled: true, params: { sd_below: 1.0, min_abs_drop: 10 }, description: "", version: 1 },
  { id: "5", code: "sustained_decline", severity: "review_load", enabled: true, params: { days: 3, below_baseline: true }, description: "", version: 1 },
  { id: "8", code: "repeated_fatigue", severity: "attention", enabled: true, params: { days: 3, fatigue_min: 7 }, description: "", version: 1 },
];

const TODAY = "2026-10-23";

const mkCheckin = (date: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: `c-${date}-${Math.random().toString(36).slice(2, 8)}`,
  athlete_id: "a1",
  checkin_date: date,
  submitted_at: `${date}T07:00:00Z`,
  sleep_score: 4, recovery_score: 4, fatigue_score: 2,
  muscle_soreness_score: 2, stress_score: 2, mood_score: 4,
  pain_status: "none", pain_location: null, pain_side: null,
  pain_severity: null, pain_onset: null, pain_triggers: [],
  swelling: null, movement_limitation: null, symptoms: null, notes: null,
  ...over,
});

const mkPost = (submittedAt: string, over: Partial<PostTrainingCheckin> = {}): PostTrainingCheckin => ({
  id: `p-${submittedAt}`,
  training_session_id: "s1",
  athlete_id: "a1",
  submitted_at: submittedAt,
  overall_feeling: 3, leg_fatigue: 3, arm_shoulder_fatigue: 3,
  pain_status: "none", pain_location: null, pain_side: null,
  pain_triggers: [], notes: null,
  ...over,
});

function ctx(over: Partial<EvalContext>): EvalContext {
  return {
    athleteId: "a1",
    today: TODAY,
    checkin: null,
    recentCheckins: [],
    dailyReadiness: [],
    baseline: null,
    postCheckins: [],
    rules: RULES,
    ...over,
  };
}

describe("readiness_drop with a perfectly stable baseline (sd = 0)", () => {
  const flatBaseline = computeBaseline(Array(10).fill(80))!; // sd = 0

  it("fires when the absolute drop reaches min_abs_drop", () => {
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        dailyReadiness: [{ date: TODAY, score: 70 }], // drop = 10
        baseline: flatBaseline,
      }),
    );
    expect(res.some((r) => r.rule_code === "readiness_drop")).toBe(true);
  });

  it("does not fire below min_abs_drop", () => {
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        dailyReadiness: [{ date: TODAY, score: 71 }], // drop = 9
        baseline: flatBaseline,
      }),
    );
    expect(res.some((r) => r.rule_code === "readiness_drop")).toBe(false);
  });
});

describe("sustained_decline requires consecutive days with data", () => {
  const baseline = computeBaseline(Array(10).fill(80));

  it("a day without a check-in breaks the streak", () => {
    // 3-day window but only 2 days have data
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        dailyReadiness: [
          { date: "2026-10-21", score: 60 },
          { date: "2026-10-23", score: 60 }, // 22nd missing
        ],
        baseline,
      }),
    );
    expect(res.some((r) => r.rule_code === "sustained_decline")).toBe(false);
  });
});

describe("load rules removed", () => {
  it("load-based rules produce no candidates even if stale enabled rows remain", () => {
    const res = evaluateAlerts(
      ctx({
        rules: [
          { id: "6", code: "load_spike", severity: "attention", enabled: true, params: { ratio: 1.5 }, description: "", version: 1 },
        ],
      }),
    );
    expect(res.some((r) => r.rule_code === "load_spike")).toBe(false);
  });
});

describe("illness_symptoms", () => {
  it("does not fire on whitespace-only symptoms", () => {
    const c = mkCheckin(TODAY, { symptoms: "   " });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    expect(res.some((r) => r.rule_code === "illness_symptoms")).toBe(false);
  });
});

describe("post-training pain", () => {
  it("fires joint_pain with severity attention (post form has no severity field)", () => {
    const p = mkPost(`${TODAY}T18:00:00Z`, { pain_status: "joint_tendon", pain_location: "knee" });
    const res = evaluateAlerts(ctx({ postCheckins: [p] }));
    const j = res.find((r) => r.rule_code === "joint_pain");
    expect(j?.severity).toBe("attention");
  });

  it("post check-in submitted yesterday UTC but today local still counts", () => {
    // 2026-10-22T23:30Z == 2026-10-23 02:30 in Chisinau (UTC+3) — "today" locally
    const p = mkPost("2026-10-22T23:30:00Z", { pain_status: "joint_tendon", pain_location: "knee" });
    const withTz = evaluateAlerts(ctx({ postCheckins: [p], timezone: "Europe/Chisinau" }));
    expect(withTz.some((r) => r.rule_code === "joint_pain")).toBe(true);
    const noTz = evaluateAlerts(ctx({ postCheckins: [p] }));
    expect(noTz.some((r) => r.rule_code === "joint_pain")).toBe(false);
  });

  it("post check-in submitted today UTC but yesterday local does NOT fire", () => {
    // 2026-10-23T00:30Z == 2026-10-22 21:30 in America/Santiago (UTC-3) —
    // belongs to the athlete's previous day and must not alert "today".
    const p = mkPost("2026-10-23T00:30:00Z", { pain_status: "joint_tendon", pain_location: "knee" });
    const res = evaluateAlerts(ctx({ postCheckins: [p], timezone: "America/Santiago" }));
    expect(res.some((r) => r.rule_code === "joint_pain")).toBe(false);
  });

  it("post check-in from the previous local day does NOT fire", () => {
    // 2026-10-22T20:00Z is 22-10-2026 23:00 in Chisinau — yesterday.
    const p = mkPost("2026-10-22T20:00:00Z", { pain_status: "joint_tendon", pain_location: "knee" });
    const res = evaluateAlerts(ctx({ postCheckins: [p], timezone: "Europe/Chisinau" }));
    expect(res.some((r) => r.rule_code === "joint_pain")).toBe(false);
  });
});

describe("repeated_fatigue", () => {
  it("a check-in-free day resets the streak", () => {
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY, { fatigue_score: 8 }),
        recentCheckins: [
          mkCheckin("2026-10-21", { fatigue_score: 8 }),
          mkCheckin("2026-10-23", { fatigue_score: 8 }), // 22nd missing
        ],
      }),
    );
    expect(res.some((r) => r.rule_code === "repeated_fatigue")).toBe(false);
  });
});

describe("snapshot confidence", () => {
  it("is insufficient while the baseline cannot be computed (7 prior days)", () => {
    const snap = buildSnapshot(mkCheckin(TODAY), Array(7).fill(75));
    expect(snap.baseline_avg).toBeNull();
    expect(snap.confidence).toBe("insufficient");
  });

  it("becomes sufficient once 8 prior days exist", () => {
    const snap = buildSnapshot(mkCheckin(TODAY), Array(8).fill(75));
    expect(snap.baseline_avg).not.toBeNull();
    expect(snap.confidence).toBe("sufficient");
  });
});
