import { z } from "zod";

const score110 = z.number().int().min(1).max(10);
const painStatus = z.enum(["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"]);
const painSide = z.enum(["left", "right", "both", "na"]);

export const morningCheckinSchema = z
  .object({
    checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sleep_score: score110,
    recovery_score: score110,
    fatigue_score: score110,
    muscle_soreness_score: score110,
    stress_score: score110,
    mood_score: score110,
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

export const postTrainingSchema = z
  .object({
    overall_feeling: score110,
    leg_fatigue: score110,
    arm_shoulder_fatigue: score110,
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

export const createUserSchema = z
  .object({
    // Athletes may have no real email — their login is the athlete code.
    email: z.string().email().max(320).optional().or(z.literal("")),
    password: z.string().min(10).max(128),
    display_name: z.string().min(1).max(120),
    role: z.enum(["athlete", "coach", "admin"]),
    preferred_language: z.enum(["ru", "ro", "en"]).default("ru"),
    timezone: z.string().max(64).default("Europe/Chisinau"),
    // The code becomes the login email local part — restrict to email-safe chars.
    athlete_code: z.string().regex(/^[A-Za-z0-9_-]+$/).min(2).max(32).optional(),
    birth_year: z.number().int().min(1990).max(new Date().getFullYear()).optional(),
  })
  .refine((v) => v.role !== "athlete" || !!v.athlete_code, {
    message: "code_required",
    path: ["athlete_code"],
  })
  .refine((v) => !!v.email || !!v.athlete_code, {
    message: "email_or_code_required",
    path: ["email"],
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
export type PostTrainingInput = z.infer<typeof postTrainingSchema>;
