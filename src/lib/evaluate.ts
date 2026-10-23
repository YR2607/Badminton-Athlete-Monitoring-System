import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, dailyConditionSeries, computeBaseline, postsByLocalDate } from "@/lib/readiness";
import { evaluateAlerts } from "@/lib/alerts";
import { addDays, localDate, localDayUtcBounds } from "@/lib/dates";
import type { AlertRule, MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";

/**
 * Recompute the athlete's readiness snapshot for `date` and evaluate alert
 * rules. Runs server-side with the service-role client (writes to
 * readiness_snapshots / alerts are restricted from regular roles by RLS).
 *
 * Called after every morning/post-training check-in submission. Alert writes
 * are deduplicated by dedup_key, so re-evaluation is safe.
 */
export async function evaluateAthleteDay(
  admin: SupabaseClient,
  athleteId: string,
  date: string,
  timezone: string,
) {
  const from = addDays(date, -40);
  // The fetch window must cover the athlete-local `from` date entirely —
  // a UTC-midnight bound silently drops the first local hours of the window.
  const windowStart = localDayUtcBounds(from, timezone).start.toISOString();

  const [{ data: checkins }, { data: sessions }, { data: post }, { data: rules }] =
    await Promise.all([
      admin
        .from("morning_checkins")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("checkin_date", from)
        .order("checkin_date", { ascending: true }),
      admin
        .from("training_sessions")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("started_at", windowStart),
      admin
        .from("post_training_checkins")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("submitted_at", windowStart),
      admin.from("alert_rules").select("*").eq("enabled", true),
    ]);

  const todayCheckin =
    (checkins as MorningCheckin[] | null)?.find((c) => c.checkin_date === date) ?? null;

  // Post-training check-ins bucketed to athlete-local days; latest wins.
  const postsAll = ((post as PostTrainingCheckin[]) ?? []).filter(
    (p) => localDate(new Date(p.submitted_at), timezone) >= from,
  );
  const postEntries = postsByLocalDate(postsAll, timezone);
  const postByDate = new Map(postEntries.map((e) => [e.date, e.post]));

  // Baseline: earliest window of daily scores (first 14 days with data).
  const series = dailyConditionSeries((checkins as MorningCheckin[]) ?? [], postEntries);
  const history = series.filter((d) => d.date < date).map((d) => d.score);
  const baseline = computeBaseline(
    series.slice(0, 14).map((d) => d.score),
  );

  if (todayCheckin) {
    const snap = buildSnapshot(todayCheckin, history, 1, postByDate.get(date));
    await admin.from("readiness_snapshots").upsert(
      {
        athlete_id: athleteId,
        snapshot_date: date,
        calculated_at: new Date().toISOString(),
        ...snap,
      },
      { onConflict: "athlete_id,snapshot_date" },
    );
  }

  const candidates = evaluateAlerts({
    athleteId,
    today: date,
    timezone,
    checkin: todayCheckin,
    recentCheckins: ((checkins as MorningCheckin[]) ?? []).filter(
      (c) => c.checkin_date >= addDays(date, -14),
    ),
    dailyReadiness: series,
    baseline,
    sessions: ((sessions as TrainingSession[]) ?? []).filter(
      (s) => localDate(new Date(s.started_at), timezone) >= from,
    ),
    postCheckins: postsAll,
    rules: (rules as AlertRule[]) ?? [],
  });

  for (const a of candidates) {
    await admin.rpc("record_alert", {
      p_athlete_id: athleteId,
      p_rule_code: a.rule_code,
      p_severity: a.severity,
      p_evidence: a.evidence,
      p_recommendation: a.recommendation,
      p_dedup_key: a.dedup_key,
      p_source_checkin_id: a.source_checkin_id,
    });
  }

  // Notify assigned coaches about priority alerts.
  const priorities = candidates.filter((c) => c.severity === "priority");
  if (priorities.length > 0) {
    const { data: coaches } = await admin
      .from("coach_assignments")
      .select("coach_profile_id, group_id, athlete_id")
      .or(`athlete_id.eq.${athleteId},group_id.in.(${await groupIdsOf(admin, athleteId)})`);
    const coachIds = [...new Set((coaches ?? []).map((c) => c.coach_profile_id as string))];
    const { data: profs } = coachIds.length
      ? await admin.from("profiles").select("id, preferred_language").in("id", coachIds)
      : { data: [] };
    const langOf = new Map((profs ?? []).map((p) => [p.id as string, p.preferred_language as string]));
    const TITLES: Record<string, string> = {
      ru: "Приоритетный сигнал",
      en: "Priority alert",
      ro: "Semnal prioritar",
    };
    for (const c of coaches ?? []) {
      const title = TITLES[langOf.get(c.coach_profile_id) ?? "ru"] ?? TITLES.ru;
      for (const p of priorities) {
        await admin.from("notifications").upsert(
          {
            profile_id: c.coach_profile_id,
            kind: "priority_alert",
            title,
            body: `${p.rule_code}: ${p.recommendation}`,
            data: { athlete_id: athleteId, rule: p.rule_code },
            dedup_key: `notif:${c.coach_profile_id}:${p.dedup_key}`,
          },
          { onConflict: "dedup_key" },
        );
      }
    }
  }

  return { snapshotWritten: !!todayCheckin, alerts: candidates.length };
}

async function groupIdsOf(admin: SupabaseClient, athleteId: string): Promise<string> {
  const { data } = await admin
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athleteId)
    .is("left_at", null);
  const ids = (data ?? []).map((g) => g.group_id);
  return ids.length > 0 ? ids.join(",") : "00000000-0000-0000-0000-000000000000";
}
