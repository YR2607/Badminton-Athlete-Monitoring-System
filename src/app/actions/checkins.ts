"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, getCurrentAthlete, audit } from "@/lib/auth";
import { evaluateAthleteDay } from "@/lib/evaluate";
import { addDays, localDate, localDayUtcBounds } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import { morningCheckinSchema, postTrainingSchema } from "@/lib/validation";
import { detectBodyZone } from "@/lib/body-zones";
import { plannedForDate, type PlanOverride, type ScheduleInput } from "@/lib/load";

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
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();
  const zscoreOn = await isFlagEnabled(
    "zscore_baseline",
    membership?.group_id ? [membership.group_id] : [],
  );

  const row = {
    athlete_id: athlete.id,
    checkin_date: today,
    sleep_score: parsed.data.sleep_score,
    sleep_hours: zscoreOn ? (parsed.data.sleep_hours ?? null) : null,
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

  // Insert-only: answers are locked after submission — edits go through
  // the coach (day page). A retry hitting the unique constraint means the
  // check-in was already submitted, not an error to report loudly.
  const { error } = await supabase.from("morning_checkins").insert(row);
  if (error)
    return { error: error.code === "23505" ? "already_submitted" : error.message };

  try {
    await evaluateAthleteDay(createAdminClient(), athlete.id, today, profile.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  await audit("checkin.morning.submit", "morning_checkins", athlete.id, { date: today });
  revalidatePath("/athlete");
  return { ok: true };
}

/**
 * Evening check-in: post-training wellness plus (behind the `srpe` flag)
 * session RPE 0-10 and minutes, which feed session_load = rpe x min.
 * `session_day: "yesterday"` backfills the previous day's session within
 * the 24h validity window.
 */
export async function submitEveningCheckin(input: unknown): Promise<ActionResult> {
  const parsed = postTrainingSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const ctx = await athleteContext();
  if (!ctx) return { error: "unauthenticated" };
  const { profile, athlete } = ctx;

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  const srpeOn = await isFlagEnabled(
    "srpe",
    membership?.group_id ? [membership.group_id] : [],
  );

  // Backfill: allow yesterday's session only (older answers are unreliable).
  const today = localDate(new Date(), profile.timezone);
  const sessionDate =
    srpeOn && parsed.data.session_day === "yesterday" ? addDays(today, -1) : today;
  const startedAt =
    sessionDate === today
      ? new Date().toISOString()
      : `${sessionDate}T18:00:00Z`; // placeholder time for backfilled sessions

  const isMatch = Boolean(parsed.data.match_discipline || parsed.data.match_result);

  // Rapid double/triple taps: an evening check-in submitted for the same
  // session day within the last 10 minutes is an update, not a new session
  // (skipped for tournament matches so an athlete can log multiple matches).
  const { data: recentPost } = isMatch
    ? { data: null }
    : await supabase
        .from("post_training_checkins")
        .select("id, training_session_id")
        .eq("athlete_id", athlete.id)
        .gte("submitted_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (recentPost) {
    const { data: recentSession } = await supabase
      .from("training_sessions")
      .select("started_at")
      .eq("id", recentPost.training_session_id)
      .maybeSingle();
    if (
      recentSession &&
      localDate(new Date(recentSession.started_at), profile.timezone) === sessionDate
    ) {
      const admin = createAdminClient();
      await admin
        .from("training_sessions")
        .update({
          session_rpe: srpeOn ? (parsed.data.session_rpe ?? null) : null,
          // Duration stays with the coach's session — only overwrite when
          // the athlete explicitly reported minutes (match logging).
          ...(parsed.data.session_minutes != null
            ? { duration_minutes: parsed.data.session_minutes }
            : {}),
          focus_tags: parsed.data.focus_tags ?? [],
        })
        .eq("id", recentPost.training_session_id)
        .eq("athlete_id", athlete.id);
      await admin
        .from("post_training_checkins")
        .update({
          overall_feeling: parsed.data.overall_feeling,
          leg_fatigue: parsed.data.leg_fatigue,
          arm_shoulder_fatigue: parsed.data.arm_shoulder_fatigue,
          pain_status: parsed.data.pain_status,
          pain_location: parsed.data.pain_location || null,
          pain_side: parsed.data.pain_side ?? null,
          pain_severity: parsed.data.pain_severity ?? null,
          pain_onset: parsed.data.pain_onset ?? null,
          pain_triggers: parsed.data.pain_triggers,
          notes: parsed.data.notes || null,
        })
        .eq("id", recentPost.id)
        .eq("athlete_id", athlete.id);
      try {
        await evaluateAthleteDay(admin, athlete.id, sessionDate, profile.timezone);
      } catch (e) {
        console.error("evaluate_failed", e);
      }
      await audit("checkin.post.update", "post_training_checkins", recentPost.training_session_id, {});
      revalidatePath("/athlete");
      return { ok: true };
    }
  }

  // Reuse an empty same-day session auto-created by attendance marking —
  // otherwise this check-in would spawn a duplicate session row.
  // (Skipped for tournament matches: each match is its own session.)
  const { start: sDayStart, end: sDayEnd } = localDayUtcBounds(
    sessionDate,
    profile.timezone,
  );
  const { data: emptySession } = isMatch
    ? { data: null }
    : await supabase
        .from("training_sessions")
        .select("id, duration_minutes")
        .eq("athlete_id", athlete.id)
        .is("session_rpe", null)
        .is("match_discipline", null)
        .gte("started_at", sDayStart.toISOString())
        .lt("started_at", sDayEnd.toISOString())
        .order("started_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  // The coach's weekly plan is the source of truth for training duration —
  // athletes only report minutes when logging a match, which has no plan.
  let plannedMinutes: number | null = null;
  if (srpeOn && parsed.data.session_minutes == null && membership?.group_id) {
    const [{ data: sch }, { data: ov }] = await Promise.all([
      supabase
        .from("training_schedules")
        .select("weekday, planned_minutes, planned_rpe")
        .eq("group_id", membership.group_id)
        .eq("active", true),
      supabase
        .from("session_plan_overrides")
        .select("plan_date, cancelled, planned_minutes, planned_rpe")
        .eq("group_id", membership.group_id)
        .eq("plan_date", sessionDate),
    ]);
    plannedMinutes = plannedForDate(
      sessionDate,
      (sch ?? []) as ScheduleInput[],
      (ov ?? []) as PlanOverride[],
    ).planned_minutes;
  }

  let session = (emptySession as { id: string; duration_minutes?: number | null } | null) ?? null;
  if (session) {
    // Admin client: sessions_update_today RLS only allows same-day updates, so
    // a backfilled check-in (yesterday's session) would silently match 0 rows.
    const { error: uErr } = await createAdminClient()
      .from("training_sessions")
      .update({
        session_rpe: srpeOn ? (parsed.data.session_rpe ?? null) : null,
        duration_minutes: srpeOn
          ? (parsed.data.session_minutes ?? session.duration_minutes ?? plannedMinutes)
          : null,
        focus_tags: parsed.data.focus_tags ?? [],
        match_discipline: parsed.data.match_discipline ?? null,
        match_result: parsed.data.match_result ?? null,
      })
      .eq("id", session.id)
      .eq("athlete_id", athlete.id);
    if (uErr) return { error: uErr.message };
  } else {
    const { data: inserted, error: sErr } = await supabase
      .from("training_sessions")
      .insert({
        athlete_id: athlete.id,
        group_id: membership?.group_id ?? null,
        started_at: startedAt,
        session_rpe: srpeOn ? (parsed.data.session_rpe ?? null) : null,
        duration_minutes: srpeOn
          ? (parsed.data.session_minutes ?? plannedMinutes)
          : null,
        focus_tags: parsed.data.focus_tags ?? [],
        match_discipline: parsed.data.match_discipline ?? null,
        match_result: parsed.data.match_result ?? null,
        client_uuid: parsed.data.client_uuid,
      })
      .select("id")
      .single();

    // A retry after a partial failure may hit the client_uuid unique constraint
    // with the session already created — reuse it instead of failing.
    session = inserted;
    if (sErr) {
      if (sErr.code !== "23505") return { error: sErr.message };
      const { data: existing } = await supabase
        .from("training_sessions")
        .select("id")
        .eq("athlete_id", athlete.id)
        .eq("client_uuid", parsed.data.client_uuid)
        .maybeSingle();
      if (!existing) return { error: "duplicate" };
      session = existing;
    }
    if (!session) return { error: "error" };
  }

  const { data: insertedPost, error } = await supabase.from("post_training_checkins").insert({
    training_session_id: session.id,
    athlete_id: athlete.id,
    overall_feeling: parsed.data.overall_feeling,
    leg_fatigue: parsed.data.leg_fatigue,
    arm_shoulder_fatigue: parsed.data.arm_shoulder_fatigue,
    pain_status: parsed.data.pain_status,
    pain_location: parsed.data.pain_location || null,
    pain_side: parsed.data.pain_side ?? null,
    pain_severity: parsed.data.pain_severity ?? null,
    pain_onset: parsed.data.pain_onset ?? null,
    pain_triggers: parsed.data.pain_triggers,
    notes: parsed.data.notes || null,
    client_uuid: parsed.data.client_uuid,
  }).select("id").single();
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };

  // Normalized pain report for the unified feed (zone/severity/triggers).
  if (parsed.data.pain_status !== "none") {
    const zone = detectBodyZone(parsed.data.pain_location);
    await createAdminClient().from("pain_reports").insert({
      athlete_id: athlete.id,
      source: "evening",
      checkin_id: insertedPost?.id ?? null,
      report_date: sessionDate,
      zone: zone ?? "other",
      side: parsed.data.pain_side ?? null,
      severity: parsed.data.pain_severity ?? null,
      triggers: parsed.data.pain_triggers,
      onset: parsed.data.pain_onset ?? null,
    });
  }

  try {
    // Recompute the session's day — for backfills that's yesterday, so its
    // snapshot folds in the evening questionnaire too.
    await evaluateAthleteDay(createAdminClient(), athlete.id, sessionDate, profile.timezone);
  } catch (e) {
    console.error("evaluate_failed", e);
  }
  await audit("checkin.post.submit", "post_training_checkins", session.id, {});
  revalidatePath("/athlete");
  return { ok: true };
}
