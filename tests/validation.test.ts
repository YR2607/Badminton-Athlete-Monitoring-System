import { describe, expect, it } from "vitest";
import { morningCheckinSchema, trainingSessionSchema, postTrainingSchema } from "@/lib/validation";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

const validMorning = {
  checkin_date: "2026-10-23",
  sleep_score: 4,
  recovery_score: 4,
  fatigue_score: 2,
  muscle_soreness_score: 2,
  stress_score: 2,
  mood_score: 4,
  pain_status: "none",
  pain_triggers: [],
  client_uuid: uuid,
};

describe("morningCheckinSchema", () => {
  it("accepts a valid check-in without pain fields", () => {
    expect(morningCheckinSchema.safeParse(validMorning).success).toBe(true);
  });

  it("rejects scores outside 1..5", () => {
    expect(morningCheckinSchema.safeParse({ ...validMorning, sleep_score: 6 }).success).toBe(false);
    expect(morningCheckinSchema.safeParse({ ...validMorning, fatigue_score: 0 }).success).toBe(false);
  });

  it("requires pain_location when pain is reported", () => {
    const r = morningCheckinSchema.safeParse({ ...validMorning, pain_status: "joint_tendon" });
    expect(r.success).toBe(false);
  });

  it("accepts pain with location", () => {
    const r = morningCheckinSchema.safeParse({
      ...validMorning,
      pain_status: "joint_tendon",
      pain_location: "колено",
      pain_severity: 6,
    });
    expect(r.success).toBe(true);
  });
});

describe("trainingSessionSchema", () => {
  it("accepts valid session", () => {
    const r = trainingSessionSchema.safeParse({
      started_at: "2026-10-23T16:00:00.000Z",
      duration_minutes: 90,
      training_type: "court",
      session_rpe: 7,
      client_uuid: uuid,
    });
    expect(r.success).toBe(true);
  });
  it("rejects rpe > 10 and absurd duration", () => {
    expect(
      trainingSessionSchema.safeParse({
        started_at: "2026-10-23T16:00:00.000Z",
        duration_minutes: 900,
        training_type: "court",
        session_rpe: 11,
        client_uuid: uuid,
      }).success,
    ).toBe(false);
  });
});

describe("postTrainingSchema", () => {
  it("links to a session and validates scales", () => {
    const ok = postTrainingSchema.safeParse({
      training_session_id: uuid,
      overall_feeling: 4,
      leg_fatigue: 3,
      arm_shoulder_fatigue: 2,
      pain_status: "none",
      pain_triggers: [],
      client_uuid: uuid,
    });
    expect(ok.success).toBe(true);
  });
});
