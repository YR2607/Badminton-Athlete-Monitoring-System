import { describe, expect, it } from "vitest";
import {
  acuteMorningFlags,
  acutePostFlags,
  ageInDays,
  athleteStatus,
  loadInRange,
  pendingPostCheckins,
  STATUS_ORDER,
} from "@/lib/athlete-status";
import { localDate } from "@/lib/dates";
import type { Baseline } from "@/lib/readiness";
import type { MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";

const mkCheckin = (over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: "c1",
  athlete_id: "a1",
  checkin_date: "2026-10-22",
  submitted_at: "2026-10-22T07:00:00Z",
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

const mkSession = (over: Partial<TrainingSession> = {}): TrainingSession => ({
  id: "s1",
  athlete_id: "a1",
  group_id: null,
  started_at: "2026-10-22T16:00:00Z",
  duration_minutes: 90,
  training_type: "mixed",
  session_rpe: 5,
  session_load: 450,
  created_at: "2026-10-22T16:00:00Z",
  ...over,
});

const mkPost = (over: Partial<PostTrainingCheckin> = {}): PostTrainingCheckin => ({
  id: "p1",
  training_session_id: "s1",
  athlete_id: "a1",
  submitted_at: "2026-10-22T19:00:00Z",
  overall_feeling: 4,
  leg_fatigue: 2,
  arm_shoulder_fatigue: 2,
  pain_status: "none",
  pain_location: null,
  pain_side: null,
  pain_triggers: [],
  notes: null,
  ...over,
});

const base = (
  over: Partial<Parameters<typeof athleteStatus>[0]> = {},
): Parameters<typeof athleteStatus>[0] => ({
  hasPrioritySignal: false,
  hasDeclineAlert: false,
  todayCheckin: mkCheckin(),
  todayScore: 80,
  baseline: { avg: 75, sd: 5, count: 10, version: 1 } as Baseline,
  observations: 12,
  ...over,
});

describe("athleteStatus", () => {
  it("today's check-in present + no signals → ok", () => {
    expect(athleteStatus(base())).toBe("ok");
  });

  it("no check-in today → no_today (stale score is not current state)", () => {
    expect(athleteStatus(base({ todayCheckin: null, todayScore: null }))).toBe("no_today");
  });

  it("no check-in today AND few observations → still no_today, not ok", () => {
    expect(
      athleteStatus(base({ todayCheckin: null, todayScore: null, baseline: null, observations: 3 })),
    ).toBe("no_today");
  });

  it("insufficient baseline → no decline conclusion even on a low score", () => {
    expect(
      athleteStatus(base({ baseline: null, todayScore: 20, observations: 5 })),
    ).toBe("insufficient");
  });

  it("today's score below personal norm → declining", () => {
    expect(athleteStatus(base({ todayScore: 60 }))).toBe("declining"); // 75-5=70 > 60
    expect(athleteStatus(base({ todayScore: 72 }))).toBe("ok");
  });

  it("open decline alert → declining even with a decent score", () => {
    expect(athleteStatus(base({ hasDeclineAlert: true, todayScore: 80 }))).toBe("declining");
  });

  it("priority signal beats a high score — never masked", () => {
    expect(athleteStatus(base({ hasPrioritySignal: true, todayScore: 95 }))).toBe("needs_check");
    // priority also beats missing data
    expect(
      athleteStatus(base({ hasPrioritySignal: true, todayCheckin: null, todayScore: null })),
    ).toBe("needs_check");
    // and beats declining
    expect(
      athleteStatus(base({ hasPrioritySignal: true, hasDeclineAlert: true, todayScore: 40 })),
    ).toBe("needs_check");
  });

  it("priority order: needs_check < declining < no_today < insufficient < ok", () => {
    expect(STATUS_ORDER.needs_check).toBeLessThan(STATUS_ORDER.declining);
    expect(STATUS_ORDER.declining).toBeLessThan(STATUS_ORDER.no_today);
    expect(STATUS_ORDER.no_today).toBeLessThan(STATUS_ORDER.insufficient);
    expect(STATUS_ORDER.insufficient).toBeLessThan(STATUS_ORDER.ok);
  });
});

describe("acuteMorningFlags", () => {
  it("detects red flags independently of the score", () => {
    expect(acuteMorningFlags(mkCheckin({ pain_status: "acute_instability" }))).toBe(true);
    expect(acuteMorningFlags(mkCheckin({ swelling: true, pain_status: "joint_tendon" }))).toBe(true);
    expect(acuteMorningFlags(mkCheckin({ movement_limitation: true }))).toBe(true);
    expect(acuteMorningFlags(mkCheckin({ pain_status: "joint_tendon", pain_severity: 8 }))).toBe(true);
    expect(acuteMorningFlags(mkCheckin({ symptoms: "температура" }))).toBe(true);
  });
  it("plain mild pain is not acute", () => {
    expect(acuteMorningFlags(mkCheckin({ pain_status: "joint_tendon", pain_severity: 4 }))).toBe(false);
    expect(acuteMorningFlags(mkCheckin())).toBe(false);
    expect(acuteMorningFlags(null)).toBe(false);
  });
});

describe("acutePostFlags", () => {
  it("only acute instability counts in a post check-in", () => {
    expect(acutePostFlags(mkPost({ pain_status: "acute_instability" }))).toBe(true);
    expect(acutePostFlags(mkPost({ pain_status: "joint_tendon" }))).toBe(false);
    expect(acutePostFlags(null)).toBe(false);
  });
});

describe("pendingPostCheckins", () => {
  const now = new Date("2026-10-22T20:00:00Z");
  it("flags a registered session past the grace window without a post check-in", () => {
    const pending = pendingPostCheckins([mkSession()], [], now);
    expect(pending).toHaveLength(1);
  });
  it("does not flag an answered or very recent session", () => {
    expect(pendingPostCheckins([mkSession()], [mkPost()], now)).toHaveLength(0);
    const justEnded = mkSession({ started_at: "2026-10-22T18:45:00Z", duration_minutes: 90 });
    expect(pendingPostCheckins([justEnded], [], now)).toHaveLength(0);
  });
  it("no session record → nothing pending (absence is not zero load)", () => {
    expect(pendingPostCheckins([], [], now)).toHaveLength(0);
  });
});

describe("loadInRange", () => {
  it("sums loads inside the local-date window only", () => {
    const s1 = mkSession({ started_at: "2026-10-20T16:00:00Z" });
    const s2 = mkSession({ started_at: "2026-10-21T16:00:00Z", session_load: 300 });
    const outside = mkSession({ id: "s9", started_at: "2026-10-10T16:00:00Z" });
    expect(loadInRange([s1, s2, outside], "Europe/Chisinau", "2026-10-20", "2026-10-26")).toBe(750);
  });
  it("missing sessions → 0, and callers must not show it as a score", () => {
    expect(loadInRange([], "UTC", "2026-10-20", "2026-10-26")).toBe(0);
  });
  it("timezones bucket the same instant to different days", () => {
    // 23:00 UTC is Oct 22 in Chisinau (+3) but still Oct 22 16:00 in LA (-7)... wait:
    // 2026-10-22T22:00Z → 23:00+3 = Oct 23 01:00 Chisinau; 15:00 LA Oct 22.
    const s = mkSession({ started_at: "2026-10-22T22:00:00Z" });
    expect(localDate(new Date(s.started_at), "Europe/Chisinau")).toBe("2026-10-23");
    expect(localDate(new Date(s.started_at), "America/Los_Angeles")).toBe("2026-10-22");
    expect(loadInRange([s], "Europe/Chisinau", "2026-10-22", "2026-10-22")).toBe(0);
    expect(loadInRange([s], "America/Los_Angeles", "2026-10-22", "2026-10-22")).toBe(450);
  });
});

describe("ageInDays", () => {
  it("whole days between dates", () => {
    expect(ageInDays("2026-10-20", "2026-10-22")).toBe(2);
    expect(ageInDays("2026-10-22", "2026-10-22")).toBe(0);
  });
});
