import { describe, expect, it } from "vitest";
import { dayStatuses, sessionDateByIdMap, sessionLocalDates } from "@/lib/checkins";
import type { MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";

const mkCheckin = (date: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: `c-${date}`,
  athlete_id: "a1",
  checkin_date: date,
  submitted_at: `${date}T07:00:00Z`,
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

const mkSession = (date: string, id = `s-${date}`): TrainingSession => ({
  id,
  athlete_id: "a1",
  group_id: null,
  started_at: `${date}T16:00:00Z`,
  duration_minutes: null,
  session_rpe: null,
  session_load: null,
  created_at: `${date}T16:00:00Z`,
});

const mkPost = (submittedAt: string, sessionId = "s-x"): PostTrainingCheckin => ({
  id: `p-${submittedAt}`,
  training_session_id: sessionId,
  athlete_id: "a1",
  submitted_at: submittedAt,
  overall_feeling: 4,
  leg_fatigue: 2,
  arm_shoulder_fatigue: 2,
  pain_status: "none",
  pain_location: null,
  pain_side: null,
  pain_triggers: [],
  notes: null,
});

const days = ["2026-10-20", "2026-10-21", "2026-10-22"];

describe("dayStatuses", () => {
  it("joins morning/evening/session per date", () => {
    const st = dayStatuses({
      days,
      checkins: [mkCheckin("2026-10-20"), mkCheckin("2026-10-22", { pain_status: "joint_tendon" })],
      posts: [mkPost("2026-10-21T18:00:00Z")],
      sessions: [mkSession("2026-10-21")],
      tz: "UTC",
    });
    expect(st.map((s) => s.morning !== null)).toEqual([true, false, true]);
    expect(st.map((s) => s.hasPain)).toEqual([false, false, true]);
    expect(st.map((s) => s.evening !== null)).toEqual([false, true, false]);
    expect(st.map((s) => s.hadSession)).toEqual([false, true, false]);
    expect(st.map((s) => s.scheduled)).toEqual([null, null, null]);
  });

  it("buckets evening check-ins in the athlete TZ and honours sessionDateById", () => {
    // UTC date is 10-20, but in Europe/Chisinau (UTC+3) it's already 10-21.
    const st = dayStatuses({
      days,
      posts: [mkPost("2026-10-20T21:30:00Z")], // 2026-10-21 00:30 local
      tz: "Europe/Chisinau",
    });
    expect(st[0].evening).toBeNull();
    expect(st[1].evening).not.toBeNull();

    // A backfilled check-in counts for its session's day when the map is given.
    const backfilled = dayStatuses({
      days,
      posts: [mkPost("2026-10-22T10:00:00Z", "s-2026-10-20")],
      sessions: [mkSession("2026-10-20")],
      sessionDateById: sessionDateByIdMap([mkSession("2026-10-20")], "UTC"),
      tz: "UTC",
    });
    expect(backfilled[0].evening).not.toBeNull();
    expect(backfilled[2].evening).toBeNull();
  });

  it("accepts pre-bucketed postEntries and sessionDates", () => {
    const st = dayStatuses<{ feeling: number }>({
      days,
      postEntries: [{ date: "2026-10-21", post: { feeling: 3 } }],
      sessionDates: ["2026-10-22"],
      scheduledFor: (d) => d === "2026-10-22",
    });
    expect(st[1].evening?.feeling).toBe(3);
    expect(st[2].hadSession).toBe(true);
    expect(st[2].scheduled).toBe(true);
    expect(st[0].scheduled).toBe(false);
  });
});

describe("sessionLocalDates", () => {
  it("returns the local dates of session starts", () => {
    const dates = sessionLocalDates(
      [mkSession("2026-10-20"), mkSession("2026-10-20"), mkSession("2026-10-22")],
      "UTC",
    );
    expect([...dates].sort()).toEqual(["2026-10-20", "2026-10-22"]);
  });
});
