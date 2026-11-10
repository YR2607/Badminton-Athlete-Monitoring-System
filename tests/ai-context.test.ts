import { describe, expect, it } from "vitest";
import { summarizeAthleteData } from "@/lib/ai/context";
import type {
  Alert,
  MorningCheckin,
  PostTrainingCheckin,
  ReadinessSnapshot,
  TrainingSession,
} from "@/lib/types";

const ck = (d: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: d,
  athlete_id: "a1",
  checkin_date: d,
  submitted_at: `${d}T08:00:00Z`,
  sleep_score: 8,
  sleep_hours: 8,
  recovery_score: 8,
  fatigue_score: 2,
  muscle_soreness_score: 2,
  stress_score: 2,
  mood_score: 8,
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

const base = {
  code: "AT-07",
  groups: ["U13"],
  from: "2026-10-26",
  to: "2026-11-08",
  days: 14,
  checkins: [] as MorningCheckin[],
  sessions: [] as TrainingSession[],
  posts: [] as PostTrainingCheckin[],
  snapshot: null as ReadinessSnapshot | null,
  alerts: [] as Alert[],
  attendance: [],
  testResults: [],
  growth: [],
};

describe("summarizeAthleteData", () => {
  it("quotes canonical snapshot values verbatim (no recalculation)", () => {
    const ctx = summarizeAthleteData({
      ...base,
      snapshot: {
        readiness_score: 62,
        baseline_avg: 71.4,
        baseline_sd: 8,
        z_score: -1.2,
        confidence: "sufficient",
        input_data_count: 21,
      } as ReadinessSnapshot,
    });
    expect(ctx.readiness.latest_score).toBe(62);
    expect(ctx.readiness.baseline_avg).toBe(71.4);
    expect(ctx.readiness.confidence).toBe("sufficient");
  });

  it("aggregates wellbeing + coverage without inventing scores", () => {
    const ctx = summarizeAthleteData({
      ...base,
      checkins: [ck("2026-11-07"), ck("2026-11-08")],
    });
    expect(ctx.wellbeing.checkins).toBe(2);
    expect(ctx.wellbeing.coverage_pct).toBe(14);
    expect(ctx.readiness.latest_score).toBeNull();
  });

  it("surfaces acute signals separately from averages", () => {
    const ctx = summarizeAthleteData({
      ...base,
      checkins: [
        ck("2026-11-08", {
          pain_status: "acute_instability",
          pain_severity: 7,
          swelling: true,
          movement_limitation: true,
        }),
      ],
    });
    expect(ctx.acute.pain_reports_7d).toBe(1);
    expect(ctx.acute.max_pain_severity_7d).toBe(7);
    expect(ctx.acute.swelling_7d).toBe(1);
    expect(ctx.acute.movement_limitation_7d).toBe(1);
  });

  it("sums session load in AU and keeps open alerts", () => {
    const ctx = summarizeAthleteData({
      ...base,
      sessions: [
        { session_load: 300, session_rpe: 6, started_at: "2026-11-07T10:00:00Z" } as TrainingSession,
        { session_load: 240, session_rpe: 4, started_at: "2026-11-08T10:00:00Z" } as TrainingSession,
      ],
      alerts: [
        { rule_code: "low_readiness", severity: "priority", triggered_at: "2026-11-08T07:00:00Z" } as Alert,
      ],
    });
    expect(ctx.load.sessions).toBe(2);
    expect(ctx.load.total_au).toBe(540);
    expect(ctx.load.rpe_avg).toBe(5);
    expect(ctx.alerts_open[0].severity).toBe("priority");
  });

  it("empty data produces nulls, not fake zeros of condition", () => {
    const ctx = summarizeAthleteData(base);
    expect(ctx.readiness.latest_score).toBeNull();
    expect(ctx.wellbeing.checkins).toBe(0);
    expect(ctx.load.sessions).toBe(0);
    expect(ctx.acute.pain_reports_7d).toBe(0);
  });
});
