import { describe, expect, it } from "vitest";
import { evaluateAlerts, type EvalContext } from "@/lib/alerts";
import { computeBaseline } from "@/lib/readiness";
import type { AlertRule, MorningCheckin } from "@/lib/types";

const RULES: AlertRule[] = [
  { id: "1", code: "acute_pain", severity: "priority", enabled: true, params: { pain_statuses: ["acute_instability"], swelling: true, movement_limitation: true, min_severity: 7 }, description: "", version: 1 },
  { id: "2", code: "illness_symptoms", severity: "priority", enabled: true, params: {}, description: "", version: 1 },
  { id: "3", code: "joint_pain", severity: "review_load", enabled: true, params: { pain_statuses: ["joint_tendon"], min_severity: 5 }, description: "", version: 1 },
  { id: "4", code: "readiness_drop", severity: "attention", enabled: true, params: { sd_below: 1.0, min_abs_drop: 10 }, description: "", version: 1 },
  { id: "5", code: "sustained_decline", severity: "review_load", enabled: true, params: { days: 3, below_baseline: true }, description: "", version: 1 },
  { id: "8", code: "repeated_fatigue", severity: "attention", enabled: true, params: { days: 3, fatigue_min: 4 }, description: "", version: 1 },
];

const TODAY = "2026-10-23";

const mkCheckin = (date: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: `c-${date}`,
  athlete_id: "a1",
  checkin_date: date,
  submitted_at: `${date}T07:00:00Z`,
  sleep_score: 4,
  recovery_score: 4,
  fatigue_score: 2,
  muscle_soreness_score: 2,
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

describe("evaluateAlerts — priority isolation", () => {
  it("fires priority alert on acute pain even with perfect readiness", () => {
    const c = mkCheckin(TODAY, {
      pain_status: "acute_instability",
      pain_location: "колено",
      pain_severity: 8,
    });
    const res = evaluateAlerts(
      ctx({
        checkin: c,
        recentCheckins: [c],
        dailyReadiness: [{ date: TODAY, score: 95 }],
      }),
    );
    const acute = res.find((r) => r.rule_code === "acute_pain");
    expect(acute).toBeDefined();
    expect(acute!.severity).toBe("priority");
    expect(acute!.evidence.pain_status).toBe("acute_instability");
  });

  it("fires priority on swelling even for muscle soreness", () => {
    const c = mkCheckin(TODAY, { pain_status: "muscle_soreness", pain_location: "икра", swelling: true });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    expect(res.some((r) => r.rule_code === "acute_pain" && r.severity === "priority")).toBe(true);
  });

  it("fires priority on reported symptoms text", () => {
    const c = mkCheckin(TODAY, { symptoms: "головокружение и слабость" });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    expect(res.some((r) => r.rule_code === "illness_symptoms" && r.severity === "priority")).toBe(true);
  });
});

describe("evaluateAlerts — joint pain", () => {
  it("mild joint pain -> attention", () => {
    const c = mkCheckin(TODAY, { pain_status: "joint_tendon", pain_severity: 3, pain_location: "плечо" });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    const j = res.find((r) => r.rule_code === "joint_pain");
    expect(j?.severity).toBe("attention");
  });

  it("severe joint pain -> review_load", () => {
    const c = mkCheckin(TODAY, { pain_status: "joint_tendon", pain_severity: 6, pain_location: "колено" });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    const j = res.find((r) => r.rule_code === "joint_pain");
    expect(j?.severity).toBe("review_load");
  });
});

describe("evaluateAlerts — readiness rules", () => {
  const baseline = computeBaseline(Array(10).fill(80));

  it("fires readiness_drop when score drops below baseline - 1sd", () => {
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        recentCheckins: [mkCheckin(TODAY)],
        dailyReadiness: [{ date: TODAY, score: 50 }],
        baseline,
      }),
    );
    expect(res.some((r) => r.rule_code === "readiness_drop")).toBe(true);
  });

  it("no readiness_drop without baseline data", () => {
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        dailyReadiness: [{ date: TODAY, score: 30 }],
        baseline: null,
      }),
    );
    expect(res.some((r) => r.rule_code === "readiness_drop")).toBe(false);
  });

  it("sustained_decline after 3 consecutive days below baseline", () => {
    const days = ["2026-10-21", "2026-10-22", "2026-10-23"];
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY),
        recentCheckins: days.map((d) => mkCheckin(d)),
        dailyReadiness: days.map((d) => ({ date: d, score: 60 })),
        baseline,
      }),
    );
    expect(res.some((r) => r.rule_code === "sustained_decline" && r.severity === "review_load")).toBe(true);
  });
});

describe("evaluateAlerts — load rules removed", () => {
  it("load rules never fire even when enabled rows still exist in the DB", () => {
    const res = evaluateAlerts(
      ctx({
        rules: [
          { id: "9", code: "load_spike", severity: "attention", enabled: true, params: { ratio: 1.5 }, description: "", version: 1 },
          { id: "10", code: "load_with_decline", severity: "review_load", enabled: true, params: { load_ratio: 1.3 }, description: "", version: 1 },
        ],
      }),
    );
    expect(res.some((r) => r.rule_code.startsWith("load"))).toBe(false);
  });
});

describe("evaluateAlerts — fatigue streak", () => {
  it("repeated_fatigue after 3 days of fatigue >= 4", () => {
    const days = ["2026-10-21", "2026-10-22", "2026-10-23"];
    const res = evaluateAlerts(
      ctx({
        checkin: mkCheckin(TODAY, { fatigue_score: 4 }),
        recentCheckins: days.map((d) => mkCheckin(d, { fatigue_score: 4 })),
      }),
    );
    expect(res.some((r) => r.rule_code === "repeated_fatigue")).toBe(true);
  });
});

describe("dedup keys", () => {
  it("dedup key is athlete+rule+date (prevents duplicates on re-eval)", () => {
    const c = mkCheckin(TODAY, { pain_status: "acute_instability", pain_location: "x", pain_severity: 9 });
    const res = evaluateAlerts(ctx({ checkin: c, recentCheckins: [c] }));
    expect(res[0].dedup_key).toBe(`a1:${res[0].rule_code}:${TODAY}`);
  });
});
