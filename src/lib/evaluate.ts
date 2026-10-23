import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, dailyReadiness, computeBaseline } from "@/lib/readiness";
import { evaluateAlerts } from "@/lib/alerts";
import { addDays, localDate } from "@/lib/dates";
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
        .gte("started_at", `${from}T00:00:00Z`),
      admin
        .from("post_training_checkins")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("submitted_at", `${from}T00:00:00Z`),
      admin.from("alert_rules").select("*").eq("enabled", true),
    ]);

  const todayCheckin =
    (checkins as MorningCheckin[] | null)?.find((c) => c.checkin_date === date) ?? null;

  // Baseline: earliest window of daily scores (first 14 days with data).
  const series = dailyReadiness((checkins as MorningCheckin[]) ?? []);
  const history = series.filter((d) => d.date < date).map((d) => d.score);
  const baseline = computeBaseline(
    series.slice(0, 14).map((d) => d.score),
  );

  if (todayCheckin) {
    const snap = buildSnapshot(todayCheckin, history);
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
    checkin: todayCheckin,
    recentCheckins: ((checkins as MorningCheckin[]) ?? []).filter(
      (c) => c.checkin_date >= addDays(date, -14),
    ),
    dailyReadiness: series,
    baseline,
    sessions: ((sessions as TrainingSession[]) ?? []).filter(
      (s) => localDate(new Date(s.started_at), timezone) >= from,
    ),
    postCheckins: ((post as PostTrainingCheckin[]) ?? []).filter(
      (p) => localDate(new Date(p.submitted_at), timezone) >= from,
    ),
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
    for (const c of coaches ?? []) {
      for (const p of priorities) {
        await admin.from("notifications").upsert(
          {
            profile_id: c.coach_profile_id,
            kind: "priority_alert",
            title: "Приоритетный сигнал",
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
