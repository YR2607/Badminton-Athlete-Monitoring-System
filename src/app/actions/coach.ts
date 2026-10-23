"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { coachNoteSchema, alertReviewSchema } from "@/lib/validation";
import { evaluateAthleteDay } from "@/lib/evaluate";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate } from "@/lib/dates";

export type ActionResult = { ok?: boolean; error?: string };

export async function addCoachNote(input: unknown): Promise<ActionResult> {
  const parsed = coachNoteSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.from("coach_notes").insert({
    athlete_id: parsed.data.athlete_id,
    coach_profile_id: profile.id,
    kind: parsed.data.kind,
    note: parsed.data.note,
  });
  if (error) return { error: error.message };
  await audit("note.create", "coach_notes", parsed.data.athlete_id, { kind: parsed.data.kind });
  revalidatePath(`/coach/athletes/${parsed.data.athlete_id}`);
  return { ok: true };
}

export async function reviewAlert(input: unknown): Promise<ActionResult> {
  const parsed = alertReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alerts")
    .update({
      status: parsed.data.status,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      resolution_note: parsed.data.resolution_note ?? null,
    })
    .eq("id", parsed.data.alert_id)
    .select("id, athlete_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "forbidden" };
  await audit("alert.review", "alerts", parsed.data.alert_id, { status: parsed.data.status });
  revalidatePath("/coach");
  revalidatePath("/coach/alerts");
  return { ok: true };
}

/** True when the current user (coach/admin) can see this athlete via RLS. */
async function canAccess(athleteId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athletes")
    .select("id")
    .eq("id", athleteId)
    .maybeSingle();
  return !!data;
}

async function requireCoach() {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return null;
  return profile;
}

export interface MorningFields {
  athlete_id: string;
  checkin_date: string;
  sleep_score: number;
  recovery_score: number;
  fatigue_score: number;
  muscle_soreness_score: number;
  stress_score: number;
  mood_score: number;
  pain_status: string;
  pain_location?: string | null;
  pain_side?: string | null;
  pain_severity?: number | null;
  pain_onset?: string | null;
  pain_triggers?: string[];
  swelling?: boolean | null;
  movement_limitation?: boolean | null;
  symptoms?: string | null;
  notes?: string | null;
}

/** Coach creates or corrects an athlete's morning check-in for any date. */
export async function coachUpsertMorningCheckin(f: MorningFields): Promise<ActionResult> {
  const me = await requireCoach();
  if (!me) return { error: "forbidden" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.checkin_date)) return { error: "validation" };
  if (!(await canAccess(f.athlete_id))) return { error: "forbidden" };

  const admin = createAdminClient();
  const { error } = await admin.from("morning_checkins").upsert(
    {
      athlete_id: f.athlete_id,
      checkin_date: f.checkin_date,
      sleep_score: f.sleep_score,
      recovery_score: f.recovery_score,
      fatigue_score: f.fatigue_score,
      muscle_soreness_score: f.muscle_soreness_score,
      stress_score: f.stress_score,
      mood_score: f.mood_score,
      pain_status: f.pain_status,
      pain_location: f.pain_location ?? null,
      pain_side: f.pain_side ?? null,
      pain_severity: f.pain_severity ?? null,
      pain_onset: f.pain_onset ?? null,
      pain_triggers: f.pain_triggers ?? [],
      swelling: f.swelling ?? null,
      movement_limitation: f.movement_limitation ?? null,
      symptoms: f.symptoms ?? null,
      notes: f.notes ?? null,
      corrected_by: me.id,
    },
    { onConflict: "athlete_id,checkin_date" },
  );
  if (error) return { error: error.message };

  await audit("checkin.coach_upsert", "morning_checkins", f.athlete_id, {
    date: f.checkin_date,
  });
  await evaluateAthleteDay(admin, f.athlete_id, f.checkin_date, me.timezone);
  revalidatePath(`/coach/athletes/${f.athlete_id}`);
  revalidatePath("/analytics");
  return { ok: true };
}

export interface SessionFields {
  id?: string;
  athlete_id: string;
  started_at: string; // ISO datetime
  duration_minutes: number;
  training_type: string;
  session_rpe: number;
  group_id?: string | null;
}

/** Coach adds or corrects a training session. */
export async function coachUpsertSession(f: SessionFields): Promise<ActionResult> {
  const me = await requireCoach();
  if (!me) return { error: "forbidden" };
  if (!(await canAccess(f.athlete_id))) return { error: "forbidden" };
  if (!f.started_at || f.duration_minutes <= 0) return { error: "validation" };

  const admin = createAdminClient();
  const row = {
    athlete_id: f.athlete_id,
    group_id: f.group_id ?? null,
    started_at: new Date(f.started_at).toISOString(),
    duration_minutes: Math.round(f.duration_minutes),
    training_type: f.training_type,
    session_rpe: f.session_rpe,
  };
  const { error } = f.id
    ? await admin.from("training_sessions").update(row).eq("id", f.id)
    : await admin.from("training_sessions").insert(row);
  if (error) return { error: error.message };

  await audit(f.id ? "session.coach_update" : "session.coach_create", "training_sessions", f.athlete_id, {
    date: f.started_at.slice(0, 10),
  });
  await evaluateAthleteDay(admin, f.athlete_id, f.started_at.slice(0, 10), me.timezone);
  revalidatePath(`/coach/athletes/${f.athlete_id}`);
  revalidatePath("/analytics");
  return { ok: true };
}

export interface PostCheckinFields {
  training_session_id: string;
  athlete_id: string;
  overall_feeling: number;
  leg_fatigue: number;
  arm_shoulder_fatigue: number;
  pain_status: string;
  pain_location?: string | null;
  pain_side?: string | null;
  pain_triggers?: string[];
  notes?: string | null;
}

/** Coach adds or corrects a post-training check-in. */
export async function coachUpsertPostCheckin(f: PostCheckinFields): Promise<ActionResult> {
  const me = await requireCoach();
  if (!me) return { error: "forbidden" };
  if (!(await canAccess(f.athlete_id))) return { error: "forbidden" };

  const admin = createAdminClient();
  const { error } = await admin.from("post_training_checkins").upsert(
    {
      training_session_id: f.training_session_id,
      athlete_id: f.athlete_id,
      overall_feeling: f.overall_feeling,
      leg_fatigue: f.leg_fatigue,
      arm_shoulder_fatigue: f.arm_shoulder_fatigue,
      pain_status: f.pain_status,
      pain_location: f.pain_location ?? null,
      pain_side: f.pain_side ?? null,
      pain_triggers: f.pain_triggers ?? [],
      notes: f.notes ?? null,
      corrected_by: me.id,
    },
    { onConflict: "training_session_id" },
  );
  if (error) return { error: error.message };

  await audit("postcheckin.coach_upsert", "post_training_checkins", f.athlete_id, {
    session: f.training_session_id,
  });
  revalidatePath(`/coach/athletes/${f.athlete_id}`);
  return { ok: true };
}

/** Re-run the rules engine for an athlete (e.g. after data corrections). */
export async function reevaluateAthlete(athleteId: string, date: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };
  const supabase = await createClient();
  // RLS check: coach can only touch assigned athletes (the select will be empty otherwise).
  const { data: a } = await supabase
    .from("athletes")
    .select("id, profile:profiles(timezone)")
    .eq("id", athleteId)
    .maybeSingle();
  if (!a) return { error: "forbidden" };
  const tz = (a as { profile?: { timezone?: string } }).profile?.timezone ?? "UTC";
  await evaluateAthleteDay(createAdminClient(), athleteId, date || localDate(new Date(), tz), tz);
  revalidatePath("/coach");
  return { ok: true };
}
