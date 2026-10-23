import { describe, expect, it } from "vitest";
import { athleteStats, periodSummary, delta } from "@/lib/analytics";
import type { Alert, MorningCheckin, TrainingSession } from "@/lib/types";

const mkCheckin = (date: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: `c-${date}`,
  athlete_id: "a1",
  checkin_date: date,
  submitted_at: `${date}T07:00:00Z`,
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

const mkSession = (date: string, load = 300): TrainingSession => ({
  id: `s-${date}-${load}`,
  athlete_id: "a1",
  group_id: null,
  started_at: `${date}T16:00:00Z`,
  duration_minutes: 90,
  session_rpe: 4,
  session_load: load,
  training_type: "court",
  created_at: `${date}T16:00:00Z`,
});

const mkAlert = (date: string): Alert => ({
  id: `al-${date}`,
  athlete_id: "a1",
  rule_code: "readiness_drop",
  severity: "attention",
  status: "open",
  evidence: {},
  recommendation: "",
  dedup_key: `a1:x:${date}`,
  source_checkin_id: null,
  triggered_at: `${date}T09:00:00Z`,
  reviewed_by: null,
  reviewed_at: null,
  resolution_note: null,
});

const days = ["2026-10-20", "2026-10-21", "2026-10-22"];

describe("athleteStats", () => {
  it("counts completion and per-day cells", () => {
    const s = athleteStats("a1", days, [mkCheckin("2026-10-20"), mkCheckin("2026-10-22")], [], []);
    expect(s.filled).toBe(2);
    expect(s.expected).toBe(3);
    expect(s.rate).toBe(67);
    expect(s.cells.map((c) => c.filled)).toEqual([true, false, true]);
  });

  it("marks pain days and averages metrics", () => {
    const s = athleteStats(
      "a1",
      days,
      [mkCheckin("2026-10-20", { pain_status: "joint_tendon", sleep_score: 2 }),
       mkCheckin("2026-10-21", { sleep_score: 4 })],
      [mkSession("2026-10-20", 400), mkSession("2026-10-21", 200)],
      [mkAlert("2026-10-20")],
    );
    expect(s.painDays).toBe(1);
    expect(s.avgSleep).toBe(3);
    expect(s.sessions).toBe(2);
    expect(s.totalLoad).toBe(600);
    expect(s.alerts).toBe(1);
    expect(s.cells[0].hasPain).toBe(true);
  });

  it("returns null averages with no check-ins", () => {
    const s = athleteStats("a1", days, [], [], []);
    expect(s.avgSleep).toBeNull();
    expect(s.avgReadiness).toBeNull();
    expect(s.rate).toBe(0);
  });
});

describe("periodSummary", () => {
  it("aggregates across athletes", () => {
    const a = athleteStats("a1", days, days.map((d) => mkCheckin(d)), [mkSession("2026-10-20")], []);
    const b = athleteStats("a2", days, [mkCheckin("2026-10-20")], [], [mkAlert("2026-10-21")]);
    const s = periodSummary([a, b]);
    expect(s.athletes).toBe(2);
    expect(s.checkinsFilled).toBe(4);
    expect(s.checkinsExpected).toBe(6);
    expect(s.fillRate).toBe(67);
    expect(s.totalLoad).toBe(300);
    expect(s.alerts).toBe(1);
  });
});

describe("delta", () => {
  it("computes signed deltas", () => {
    expect(delta(80, 70)).toBe(10);
    expect(delta(60, 80)).toBe(-20);
    expect(delta(null, 50)).toBeNull();
    expect(delta(50, null)).toBeNull();
  });
});
