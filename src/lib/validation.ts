import { z } from "zod";

const score15 = z.number().int().min(1).max(5);
const painStatus = z.enum(["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"]);
const painSide = z.enum(["left", "right", "both", "na"]);
const trainingType = z.enum([
  "court",
  "technique",
  "game",
  "physical",
  "strength",
  "recovery",
  "mixed",
]);

export const morningCheckinSchema = z
  .object({
    checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sleep_score: score15,
    recovery_score: score15,
    fatigue_score: score15,
    muscle_soreness_score: score15,
    stress_score: score15,
    mood_score: score15,
    pain_status: painStatus,
    pain_location: z.string().max(200).optional().or(z.literal("")),
    pain_side: painSide.optional(),
    pain_severity: z.number().int().min(1).max(10).optional(),
    pain_onset: z.string().max(120).optional().or(z.literal("")),
    pain_triggers: z.array(z.enum(["walking", "jumping", "lunges", "rest"])).default([]),
    swelling: z.boolean().optional(),
    movement_limitation: z.boolean().optional(),
    symptoms: z.string().max(1000).optional().or(z.literal("")),
    notes: z.string().max(1000).optional().or(z.literal("")),
    client_uuid: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.pain_status !== "none") {
      if (!v.pain_location?.trim()) {
        ctx.addIssue({ code: "custom", path: ["pain_location"], message: "required_if_pain" });
      }
    }
  });

export const trainingSessionSchema = z.object({
  started_at: z.string().min(10),
  duration_minutes: z.number().int().min(1).max(600),
  training_type: trainingType,
  session_rpe: z.number().int().min(0).max(10),
  client_uuid: z.string().uuid(),
});

export const postTrainingSchema = z
  .object({
    training_session_id: z.string().uuid(),
    overall_feeling: score15,
    leg_fatigue: score15,
    arm_shoulder_fatigue: score15,
    pain_status: painStatus,
    pain_location: z.string().max(200).optional().or(z.literal("")),
    pain_side: painSide.optional(),
    pain_triggers: z.array(z.enum(["walking", "jumping", "lunges", "rest"])).default([]),
    notes: z.string().max(1000).optional().or(z.literal("")),
    client_uuid: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.pain_status !== "none" && !v.pain_location?.trim()) {
      ctx.addIssue({ code: "custom", path: ["pain_location"], message: "required_if_pain" });
    }
  });

export const createUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(128),
  display_name: z.string().min(1).max(120),
  role: z.enum(["athlete", "coach", "admin"]),
  preferred_language: z.enum(["ru", "ro", "en"]).default("ru"),
  timezone: z.string().max(64).default("Europe/Chisinau"),
  athlete_code: z.string().min(2).max(32).optional(),
  birth_year: z.number().int().min(1990).max(new Date().getFullYear()).optional(),
});

export const coachNoteSchema = z.object({
  athlete_id: z.string().uuid(),
  kind: z.enum(["note", "decision"]).default("note"),
  note: z.string().min(1).max(5000),
});

export const alertReviewSchema = z.object({
  alert_id: z.string().uuid(),
  status: z.enum(["acknowledged", "resolved", "dismissed"]),
  resolution_note: z.string().max(2000).optional(),
});

export type MorningCheckinInput = z.infer<typeof morningCheckinSchema>;
export type TrainingSessionInput = z.infer<typeof trainingSessionSchema>;
export type PostTrainingInput = z.infer<typeof postTrainingSchema>;
