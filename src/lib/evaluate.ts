import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, dailyConditionSeries, computeBaseline, postsByLocalDate, rollingNorm, rollingItemNorms, itemZScores, zScore, SD_FLOOR_SCORE, ROLLING_WINDOW_DAYS } from "@/lib/readiness";
import { evaluateAlerts } from "@/lib/alerts";
import { dailyLoads, acwrEwma, type ScheduleInput, type SessionInput } from "@/lib/load";
import { evaluateRecommendations } from "@/lib/recommendations";
import { decimalAge, growthVelocity, khamisRoche } from "@/lib/growth";
import { flagEnabled } from "@/lib/flags";
import { addDays, dateRange, localDate, localDayUtcBounds } from "@/lib/dates";
import type { AlertRule, Athlete, FeatureFlag, GrowthMeasurement, MorningCheckin, PostTrainingCheckin, TrainingSchedule, TrainingSession } from "@/lib/types";

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

  const [{ data: checkins }, { data: post }, { data: rules }, { data: sessions }, { data: membership }, { data: flags }, { data: athleteRow }, { data: growthRows }] =
    await Promise.all([
      admin
        .from("morning_checkins")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("checkin_date", from)
        .order("checkin_date", { ascending: true }),
      admin
        .from("post_training_checkins")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("submitted_at", windowStart),
      admin.from("alert_rules").select("*").eq("enabled", true),
      admin
        .from("training_sessions")
        .select("id, started_at, session_rpe, duration_minutes, group_id")
        .eq("athlete_id", athleteId)
        .gte("started_at", windowStart),
      admin
        .from("group_memberships")
        .select("group_id")
        .eq("athlete_id", athleteId)
        .is("left_at", null)
        .limit(1)
        .maybeSingle(),
      admin.from("feature_flags").select("key, enabled, group_ids"),
      admin.from("athletes").select("*").eq("id", athleteId).maybeSingle(),
      admin
        .from("growth_measurements")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("measured_on", { ascending: false })
        .limit(6),
    ]);

  const groupId = membership?.group_id ?? null;
  const { data: schedules } = groupId
    ? await admin
        .from("training_schedules")
        .select("weekday, planned_minutes, planned_rpe")
        .eq("group_id", groupId)
        .eq("active", true)
    : { data: null };

  // Check-ins are bucketed by the session's local date, not submitted_at —
  // a backfilled questionnaire belongs to the day it describes.
  const sessionDateById = new Map(
    ((sessions as TrainingSession[] | null) ?? []).map((s) => [
      s.id,
      localDate(new Date(s.started_at), timezone),
    ]),
  );

  const todayCheckin =
    (checkins as MorningCheckin[] | null)?.find((c) => c.checkin_date === date) ?? null;

  // Post-training check-ins bucketed to athlete-local days; latest wins.
  const postsAll = ((post as PostTrainingCheckin[]) ?? []).filter(
    (p) => localDate(new Date(p.submitted_at), timezone) >= from,
  );
  const postEntries = postsByLocalDate(postsAll, timezone, sessionDateById);
  const postByDate = new Map(postEntries.map((e) => [e.date, e.post]));

  // Baseline: earliest window of daily scores (first 14 days with data).
  const series = dailyConditionSeries((checkins as MorningCheckin[]) ?? [], postEntries);
  const history = series.filter((d) => d.date < date).map((d) => d.score);
  const baseline = computeBaseline(
    series.slice(0, 14).map((d) => d.score),
  );

  // Daily load series (sRPE x minutes) + plan from the group schedule.
  const sessionInputs: SessionInput[] = ((sessions as TrainingSession[] | null) ?? []).map(
    (s) => ({
      date: sessionDateById.get(s.id)!,
      rpe: s.session_rpe,
      minutes: s.duration_minutes,
    }),
  );
  const loads = dailyLoads(
    dateRange(from, date),
    sessionInputs,
    ((schedules as TrainingSchedule[] | null) ?? []) as ScheduleInput[],
  );
  const flagRows = (flags as FeatureFlag[] | null) ?? [];
  const groupIds = groupId ? [groupId] : [];
  const loadEnabled = flagEnabled(flagRows, "srpe", groupIds);
  const zscoreEnabled = flagEnabled(flagRows, "zscore_baseline", groupIds);
  const growthEnabled = flagEnabled(flagRows, "growth", groupIds);

  // ---- Phase 4: growth & maturation (%PAH band / velocity) ----
  let growthPct: number | null = null;
  let growthVelocityValue: number | null = null;
  if (growthEnabled) {
    const ath = athleteRow as Athlete | null;
    const ms = ((growthRows as GrowthMeasurement[] | null) ?? []).slice().reverse();
    const last = ms.at(-1);
    growthVelocityValue = growthVelocity(
      ms.map((m) => ({ measured_on: m.measured_on, height_cm: m.height_cm, weight_kg: m.weight_kg })),
    );
    if (
      ath?.birth_date && ath.sex && last &&
      ath.mother_height_cm != null && ath.father_height_cm != null &&
      last.weight_kg != null
    ) {
      const kr = khamisRoche(
        ath.sex,
        last.height_cm,
        last.weight_kg,
        ath.mother_height_cm,
        ath.father_height_cm,
        decimalAge(ath.birth_date, date),
      );
      growthPct = kr?.pctPah ?? null;
    }
  }

  // ---- Phase 2: rolling 28-day norms (excluding today) per item + score ----
  let zToday: number | null = null;
  let itemBaselines: Record<string, unknown> | null = null;
  let itemZ: Record<string, number | null> | null = null;
  let scoreNorm: ReturnType<typeof rollingNorm> = null;
  if (zscoreEnabled) {
    const from28 = addDays(date, -ROLLING_WINDOW_DAYS);
    const window28 = ((checkins as MorningCheckin[] | null) ?? []).filter(
      (c) => c.checkin_date >= from28 && c.checkin_date < date,
    );
    const normScores = series
      .filter((d) => d.date >= from28 && d.date < date)
      .map((d) => d.score);
    scoreNorm = rollingNorm(normScores, SD_FLOOR_SCORE);
    const todayScore = series.find((d) => d.date === date)?.score ?? null;
    zToday = todayScore !== null ? zScore(todayScore, scoreNorm) : null;
    const iNorms = rollingItemNorms(window28);
    itemBaselines = Object.fromEntries(
      Object.entries(iNorms).map(([k, v]) => [k, v ?? null]),
    );
    if (todayCheckin) itemZ = itemZScores(todayCheckin, iNorms);
  }

  if (todayCheckin) {
    const snap = buildSnapshot(todayCheckin, history, 1, postByDate.get(date));
    await admin.from("readiness_snapshots").upsert(
      {
        athlete_id: athleteId,
        snapshot_date: date,
        calculated_at: new Date().toISOString(),
        ...snap,
        z_score: zToday,
        score_norm: scoreNorm,
        item_baselines: itemBaselines,
        item_zscores: itemZ,
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
    postCheckins: postsAll,
    rules: (rules as AlertRule[]) ?? [],
    loads,
    loadEnabled,
    zToday,
    scoreNorm,
    zscoreEnabled,
    growthPct,
    growthVelocity: growthVelocityValue,
    growthEnabled,
  });

  // ---- Phase 8: coach recommendations (flag 'recommendations') ----
  const recsEnabled = flagEnabled(flagRows, "recommendations", groupIds);
  if (recsEnabled) {
    const acwr = acwrEwma(loads.map((d) => d.load));
    const candidates2 = evaluateRecommendations({
      z: zscoreEnabled ? zToday : null,
      acwr: loadEnabled ? (acwr?.ratio ?? null) : null,
      itemZ,
      acutePain: candidates.some((c) => c.rule_code === "acute_pain"),
      growthPct,
    });
    if (candidates2.length > 0) {
      await admin.from("recommendations").upsert(
        candidates2.map((r) => ({
          athlete_id: athleteId,
          rec_date: date,
          rule_key: r.rule_key,
          severity: r.severity,
          inputs: r.inputs,
        })),
        { onConflict: "athlete_id,rec_date,rule_key", ignoreDuplicates: true },
      );
    }
  }

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

  // Notify all coaches about priority alerts.
  const priorities = candidates.filter((c) => c.severity === "priority");
  if (priorities.length > 0) {
    const { data: coaches } = await admin
      .from("profiles")
      .select("id, preferred_language")
      .eq("role", "coach");
    const TITLES: Record<string, string> = {
      ru: "Приоритетный сигнал",
      en: "Priority alert",
      ro: "Semnal prioritar",
    };
    for (const c of coaches ?? []) {
      const title = TITLES[c.preferred_language ?? "ru"] ?? TITLES.ru;
      for (const p of priorities) {
        await admin.from("notifications").upsert(
          {
            profile_id: c.id,
            kind: "priority_alert",
            title,
            body: `${p.rule_code}: ${p.recommendation}`,
            data: { athlete_id: athleteId, rule: p.rule_code },
            dedup_key: `notif:${c.id}:${p.dedup_key}`,
          },
          { onConflict: "dedup_key" },
        );
      }
    }
  }

  return { snapshotWritten: !!todayCheckin, alerts: candidates.length };
}
