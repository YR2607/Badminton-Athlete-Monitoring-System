"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, getCurrentAthlete, audit } from "@/lib/auth";
import { evaluateAthleteDay } from "@/lib/evaluate";
import { localDate } from "@/lib/dates";
import {
  morningCheckinSchema,
  trainingSessionSchema,
  postTrainingSchema,
} from "@/lib/validation";

export type ActionResult = { ok?: boolean; error?: string };

async function athleteContext() {
  const profile = await getCurrentProfile();
  const athlete = await getCurrentAthlete();
  if (!profile || !athlete) return null;
  return { profile, athlete };
}

export async function submitMorningCheckin(input: unknown): Promise<ActionResult> {
  const parsed = morningCheckinSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const ctx = await athleteContext();
  if (!ctx) return { error: "unauthenticated" };
  const { profile, athlete } = ctx;

  // Never trust the client-provided date blindly: only today (athlete TZ).
  const today = localDate(new Date(), profile.timezone);
  if (parsed.data.checkin_date !== today) return { error: "invalid_date" };

  const supabase = await createClient();
  const row = {
    athlete_id: athlete.id,
    checkin_date: today,
    sleep_score: parsed.data.sleep_score,
    recovery_score: parsed.data.recovery_score,
    fatigue_score: parsed.data.fatigue_score,
    muscle_soreness_score: parsed.data.muscle_soreness_score,
    stress_score: parsed.data.stress_score,
    mood_score: parsed.data.mood_score,
    pain_status: parsed.data.pain_status,
    pain_location: parsed.data.pain_location || null,
    pain_side: parsed.data.pain_side ?? null,
    pain_severity: parsed.data.pain_severity ?? null,
    pain_onset: parsed.data.pain_onset || null,
    pain_triggers: parsed.data.pain_triggers,
    swelling: parsed.data.swelling ?? null,
    movement_limitation: parsed.data.movement_limitation ?? null,
    symptoms: parsed.data.symptoms || null,
    notes: parsed.data.notes || null,
    client_uuid: parsed.data.client_uuid,
  };

  const { error } = await supabase
    .from("morning_checkins")
    .upsert(row, { onConflict: "athlete_id,checkin_date" });
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };

  try {
    await evaluateAthleteDay(createAdminClient(), athlete.id, today, profile.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  await audit("checkin.morning.submit", "morning_checkins", athlete.id, { date: today });
  revalidatePath("/athlete");
  return { ok: true };
}

export async function submitTrainingSession(input: unknown): Promise<ActionResult & { session_id?: string }> {
  const parsed = trainingSessionSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const ctx = await athleteContext();
  if (!ctx) return { error: "unauthenticated" };
  const { athlete } = ctx;

  const started = new Date(parsed.data.started_at);
  if (Number.isNaN(started.getTime()) || started.getTime() > Date.now() + 3600_000) {
    return { error: "invalid_date" };
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("training_sessions")
    .insert({
      athlete_id: athlete.id,
      group_id: membership?.group_id ?? null,
      started_at: started.toISOString(),
      duration_minutes: parsed.data.duration_minutes,
      training_type: parsed.data.training_type,
      session_rpe: parsed.data.session_rpe,
      client_uuid: parsed.data.client_uuid,
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };

  await audit("session.create", "training_sessions", data.id, {});
  revalidatePath("/athlete");
  return { ok: true, session_id: data.id };
}

/**
 * Combined "after training" submission: creates the session row first
 * (duration + RPE + type), then the post-training check-in linked to it.
 */
export async function submitTraining(input: {
  session: unknown;
  checkin: unknown;
}): Promise<ActionResult> {
  const s = await submitTrainingSession(input.session);
  if (!s.ok || !s.session_id) return { error: s.error ?? "error" };
  const c = await submitPostTraining({
    ...(typeof input.checkin === "object" && input.checkin !== null ? input.checkin : {}),
    training_session_id: s.session_id,
  });
  if (!c.ok) return { error: c.error ?? "error" };
  return { ok: true };
}

export async function submitPostTraining(input: unknown): Promise<ActionResult> {
  const parsed = postTrainingSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const ctx = await athleteContext();
  if (!ctx) return { error: "unauthenticated" };
  const { profile, athlete } = ctx;

  const supabase = await createClient();
  // Verify the session belongs to this athlete (IDOR protection).
  const { data: session } = await supabase
    .from("training_sessions")
    .select("id, started_at")
    .eq("id", parsed.data.training_session_id)
    .eq("athlete_id", athlete.id)
    .maybeSingle();
  if (!session) return { error: "forbidden" };

  const { error } = await supabase.from("post_training_checkins").insert({
    training_session_id: session.id,
    athlete_id: athlete.id,
    overall_feeling: parsed.data.overall_feeling,
    leg_fatigue: parsed.data.leg_fatigue,
    arm_shoulder_fatigue: parsed.data.arm_shoulder_fatigue,
    pain_status: parsed.data.pain_status,
    pain_location: parsed.data.pain_location || null,
    pain_side: parsed.data.pain_side ?? null,
    pain_triggers: parsed.data.pain_triggers,
    notes: parsed.data.notes || null,
    client_uuid: parsed.data.client_uuid,
  });
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };

  const date = localDate(new Date(session.started_at), profile.timezone);
  try {
    await evaluateAthleteDay(createAdminClient(), athlete.id, date, profile.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  await audit("checkin.post.submit", "post_training_checkins", session.id, {});
  revalidatePath("/athlete");
  return { ok: true };
}
