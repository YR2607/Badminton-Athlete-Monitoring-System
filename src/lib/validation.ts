import { z } from "zod";

const score110 = z.number().int().min(1).max(10);
const painStatus = z.enum(["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"]);
const painSide = z.enum(["left", "right", "both", "na"]);

export const morningCheckinSchema = z
  .object({
    checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sleep_score: score110,
    // Optional self-reported sleep duration (Phase 2, 'zscore_baseline' flag).
    sleep_hours: z.number().min(0).max(16).multipleOf(0.5).optional().nullable(),
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
    // sRPE load fields — optional so the flag-off rollout still validates.
    session_rpe: z.number().int().min(0).max(10).optional(),
    session_minutes: z.number().int().min(1).max(600).optional(),
    // "yesterday" allows backfilling the previous day's session (24h window).
    session_day: z.enum(["today", "yesterday"]).optional(),
    focus_tags: z.array(z.enum(["lunges", "smashes", "endurance", "technique"])).default([]),
    match_discipline: z.enum(["MS", "WS", "MD", "WD", "XD"]).optional().nullable(),
    match_result: z.enum(["win", "loss"]).optional().nullable(),
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

export const recommendationReviewSchema = z.object({
  recommendation_id: z.string().uuid(),
  decision: z.enum(["accepted", "modified", "rejected"]),
  coach_comment: z.string().max(2000).optional(),
});

export const athleteGrowthSchema = z.object({
  athlete_id: z.string().uuid(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  sex: z.enum(["male", "female"]).optional().or(z.literal("")),
  mother_height_cm: z.number().min(100).max(220).optional().nullable(),
  father_height_cm: z.number().min(100).max(220).optional().nullable(),
});

export const ostrcZoneResponseSchema = z.object({
  zone_code: z.string().min(1).max(40),
  q1: z.number().int(),
  q2: z.number().int().nullish(),
  q3: z.number().int().nullish(),
  q4: z.number().int().nullish(),
  onset_date: z.string().date().nullish(),
  days_missed: z.number().int().min(0).max(7).nullish(),
  informed: z.array(z.string().max(20)).max(5).default([]),
  other_reason: z.boolean().default(false),
  comment: z.string().trim().max(2000).nullish(),
});

export const ostrcSubmitSchema = z.object({
  week_start_date: z.string().date(),
  locale: z.string().max(5).optional(),
  zones: z.array(ostrcZoneResponseSchema).min(1).max(12),
});

export const calendarEventSchema = z
  .object({
    athlete_id: z.string().uuid().nullable().optional(),
    group_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["competition", "camp", "school", "illness", "vacation", "other"]),
    title: z.string().trim().min(1).max(200),
    start_date: z.string().date(),
    end_date: z.string().date(),
  })
  .refine((s) => Boolean(s.athlete_id) !== Boolean(s.group_id), {
    message: "exactly one of athlete_id / group_id",
  })
  .refine((s) => s.end_date >= s.start_date, { message: "end_date before start_date" });

export const fieldTestResultSchema = z.object({
  athlete_id: z.string().uuid(),
  test_id: z.string().uuid(),
  test_date: z.string().date(),
  value: z.number().finite(),
  attempt: z.number().int().min(1).max(9).default(1),
});

export const fieldTestSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
  name_ru: z.string().trim().min(1).max(120),
  name_en: z.string().trim().min(1).max(120),
  name_ro: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(12),
  higher_better: z.boolean(),
  instruction_ru: z.string().trim().max(2000).optional(),
  instruction_en: z.string().trim().max(2000).optional(),
  instruction_ro: z.string().trim().max(2000).optional(),
});

export const growthMeasurementSchema = z.object({
  athlete_id: z.string().uuid(),
  measured_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  height_cm: z.number().min(50).max(230),
  weight_kg: z.number().min(10).max(200).optional().nullable(),
  sitting_height_cm: z.number().min(20).max(120).optional().nullable(),
});

export type MorningCheckinInput = z.infer<typeof morningCheckinSchema>;
export type PostTrainingInput = z.infer<typeof postTrainingSchema>;
