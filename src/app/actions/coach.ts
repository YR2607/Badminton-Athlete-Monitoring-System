"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { coachNoteSchema, alertReviewSchema, recommendationReviewSchema, athleteGrowthSchema, growthMeasurementSchema } from "@/lib/validation";
import { evaluateAthleteDay } from "@/lib/evaluate";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFlagEnabled } from "@/lib/flags";
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

  // Phase 9: the athlete sees that the coach reacted to their signal.
  try {
    const admin = createAdminClient();
    const { data: aRow } = await admin
      .from("athletes")
      .select("profile_id, group_memberships(group_id)")
      .eq("id", data.athlete_id)
      .maybeSingle();
    const aProf = aRow?.profile_id as string | undefined;
    const gIds = ((aRow?.group_memberships as { group_id: string }[] | null) ?? []).map((g) => g.group_id);
    if (aProf && (await isFlagEnabled("push", gIds))) {
      const { data: aProfile } = await admin
        .from("profiles")
        .select("preferred_language")
        .eq("id", aProf)
        .maybeSingle();
      const lang = (aProfile?.preferred_language as string | undefined) ?? "ru";
      const t =
        {
          ru: { title: "RallyMonitor", body: "Тренер посмотрел твой сигнал — всё под контролем" },
          en: { title: "RallyMonitor", body: "Your coach reviewed your signal — all good" },
          ro: { title: "RallyMonitor", body: "Antrenorul a văzut semnalul tău — totul e în regulă" },
        }[lang] ?? { title: "RallyMonitor", body: "Coach reviewed your signal" };
      const { data: ins } = await admin
        .from("notifications")
        .upsert(
          {
            profile_id: aProf,
            kind: "alert_reviewed",
            title: t.title,
            body: t.body,
            dedup_key: `alert_reviewed:${parsed.data.alert_id}`,
          },
          { onConflict: "dedup_key", ignoreDuplicates: true },
        )
        .select("id");
      if (ins?.length) {
        const { sendPushToProfile } = await import("@/lib/push");
        await sendPushToProfile(admin, aProf, { title: t.title, body: t.body, url: "/athlete" });
      }
    }
  } catch (e) {
    console.error("alert_reviewed_notify_failed", e);
  }
  revalidatePath("/coach");
  revalidatePath("/coach/alerts");
  return { ok: true };
}

/** Coach decision on a recommendation: accepted / modified / rejected. */
export async function reviewRecommendation(input: unknown): Promise<ActionResult> {
  const parsed = recommendationReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendations")
    .update({
      decision: parsed.data.decision,
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
      coach_comment: parsed.data.coach_comment?.trim() || null,
    })
    .eq("id", parsed.data.recommendation_id)
    .eq("decision", "pending") // decisions are final once made
    .select("id, athlete_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "forbidden" };
  await audit("recommendation.review", "recommendations", parsed.data.recommendation_id, {
    decision: parsed.data.decision,
  });
  revalidatePath(`/coach/athletes/${data.athlete_id}`);
  return { ok: true };
}

/** Athlete row + timezone when the current user may access it via RLS. */
async function athleteAccess(
  athleteId: string,
): Promise<{ id: string; timezone: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athletes")
    .select("id, profile:profiles(timezone)")
    .eq("id", athleteId)
    .maybeSingle();
  if (!data) return null;
  const tz = (data as { profile?: { timezone?: string } }).profile?.timezone ?? "UTC";
  return { id: data.id, timezone: tz };
}

async function requireCoach() {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return null;
  return profile;
}

/**
 * Growth section (Phase 4, flag 'growth'): coach/admin records birth date,
 * sex and biological parents' heights (with parental consent). Coaches lack
 * UPDATE on `athletes` by RLS, so the write goes through the service client
 * after an explicit access check; everything lands in the audit log.
 */
export async function updateAthleteGrowth(input: unknown): Promise<ActionResult> {
  const parsed = athleteGrowthSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await requireCoach();
  if (!profile) return { error: "forbidden" };

  // Access check through RLS: returns the row only if this coach may see it.
  const access = await athleteAccess(parsed.data.athlete_id);
  if (!access) return { error: "forbidden" };

  // Phase 10: parent data (birth date, sex, parents' heights) requires a
  // currently-granted parental consent record.
  const admin0 = createAdminClient();
  const { data: consent } = await admin0
    .from("consent_records")
    .select("status")
    .eq("athlete_id", parsed.data.athlete_id)
    .eq("consent_type", "parental_data_processing")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (consent?.status !== "granted") return { error: "consent_required" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("athletes")
    .update({
      birth_date: parsed.data.birth_date || null,
      sex: parsed.data.sex || null,
      mother_height_cm: parsed.data.mother_height_cm ?? null,
      father_height_cm: parsed.data.father_height_cm ?? null,
    })
    .eq("id", parsed.data.athlete_id);
  if (error) return { error: error.message };
  await audit("athlete.growth.update", "athletes", parsed.data.athlete_id, {});
  revalidatePath(`/coach/athletes/${parsed.data.athlete_id}`);
  return { ok: true };
}

export async function addGrowthMeasurement(input: unknown): Promise<ActionResult> {
  const parsed = growthMeasurementSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await requireCoach();
  if (!profile) return { error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.from("growth_measurements").upsert(
    {
      athlete_id: parsed.data.athlete_id,
      measured_on: parsed.data.measured_on,
      height_cm: parsed.data.height_cm,
      weight_kg: parsed.data.weight_kg ?? null,
      sitting_height_cm: parsed.data.sitting_height_cm ?? null,
      entered_by: profile.id,
    },
    { onConflict: "athlete_id,measured_on" },
  );
  if (error) return { error: error.message };
  await audit("growth.measure", "growth_measurements", parsed.data.athlete_id, {
    measured_on: parsed.data.measured_on,
  });
  // New measurement may change %PAH / velocity -> re-run the day evaluation.
  try {
    const tz = accessTz(parsed.data.athlete_id, profile);
    const today = localDate(new Date(), await tz);
    await evaluateAthleteDay(createAdminClient(), parsed.data.athlete_id, today, await tz);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  revalidatePath(`/coach/athletes/${parsed.data.athlete_id}`);
  return { ok: true };
}

/** Resolve an athlete's timezone through the RLS-visible profile join. */
async function accessTz(athleteId: string, fallback: { timezone: string }): Promise<string> {
  const a = await athleteAccess(athleteId);
  return a?.timezone ?? fallback.timezone;
}

export interface MorningFields {
  athlete_id: string;
  checkin_date: string;
  sleep_score: number;
  sleep_hours?: number | null;
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
  const athlete = await athleteAccess(f.athlete_id);
  if (!athlete) return { error: "forbidden" };

  const admin = createAdminClient();
  const { error } = await admin.from("morning_checkins").upsert(
    {
      athlete_id: f.athlete_id,
      checkin_date: f.checkin_date,
      sleep_score: f.sleep_score,
      sleep_hours: f.sleep_hours ?? null,
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
  try {
    await evaluateAthleteDay(admin, f.athlete_id, f.checkin_date, athlete.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  revalidatePath(`/coach/athletes/${f.athlete_id}`);
  revalidatePath("/analytics");
  return { ok: true };
}

export interface PostCheckinFields {
  /** Existing session to attach to; when null, a session marker is created for `session_date`. */
  training_session_id: string | null;
  /** YYYY-MM-DD — required when creating the session marker. */
  session_date?: string;
  athlete_id: string;
  overall_feeling: number;
  leg_fatigue: number;
  arm_shoulder_fatigue: number;
  session_rpe?: number | null;
  session_minutes?: number | null;
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
  const athlete = await athleteAccess(f.athlete_id);
  if (!athlete) return { error: "forbidden" };

  const admin = createAdminClient();
  let session: { id: string; started_at: string } | null = null;
  if (f.training_session_id) {
    // The session must belong to the same athlete — otherwise an upsert keyed
    // on training_session_id could overwrite another athlete's post check-in.
    const { data } = await admin
      .from("training_sessions")
      .select("id, started_at")
      .eq("id", f.training_session_id)
      .eq("athlete_id", f.athlete_id)
      .maybeSingle();
    if (!data) return { error: "forbidden" };
    session = data;
  } else {
    // No session on that day — create the "training happened" marker so the
    // check-in has a parent row. Midday UTC keeps it inside the local date.
    if (!f.session_date || !/^\d{4}-\d{2}-\d{2}$/.test(f.session_date)) {
      return { error: "validation" };
    }
    const { data: membership } = await admin
      .from("group_memberships")
      .select("group_id")
      .eq("athlete_id", f.athlete_id)
      .is("left_at", null)
      .limit(1)
      .maybeSingle();
    const { data: created, error: sErr } = await admin
      .from("training_sessions")
      .insert({
        athlete_id: f.athlete_id,
        group_id: membership?.group_id ?? null,
        started_at: `${f.session_date}T12:00:00Z`,
      })
      .select("id, started_at")
      .single();
    if (sErr) return { error: sErr.message };
    session = created;
  }

  // sRPE lives on the session row; the coach may correct it like the scales.
  if (f.session_rpe != null || f.session_minutes != null) {
    const sUpdate: Record<string, number> = {};
    if (f.session_rpe != null) sUpdate.session_rpe = f.session_rpe;
    if (f.session_minutes != null) sUpdate.duration_minutes = f.session_minutes;
    const { error: sErr } = await admin
      .from("training_sessions")
      .update(sUpdate)
      .eq("id", session.id);
    if (sErr) return { error: sErr.message };
  }

  const { error } = await admin.from("post_training_checkins").upsert(
    {
      training_session_id: session.id,
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
    session: session.id,
  });
  const date = localDate(new Date(session.started_at), athlete.timezone);
  try {
    await evaluateAthleteDay(admin, f.athlete_id, date, athlete.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  revalidatePath(`/coach/athletes/${f.athlete_id}`);
  revalidatePath("/analytics");
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
