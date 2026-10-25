import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, computeBaseline, rollingNorm, rollingItemNorms, itemZScores, zScore, SD_FLOOR_SCORE, ROLLING_WINDOW_DAYS, type Baseline, type RollingNorm } from "@/lib/readiness";
import { evaluateAlerts, type AlertCandidate } from "@/lib/alerts";
import { ALERT_PUSH_TITLES } from "@/lib/alert-texts";
import { dailyLoads, acwrEwma, type DayLoad } from "@/lib/load";
import { evaluateRecommendations } from "@/lib/recommendations";
import { decimalAge, growthVelocity, khamisRoche } from "@/lib/growth";
import { flagEnabled } from "@/lib/flags";
import { addDays, dateRange } from "@/lib/dates";
import { getDictionary } from "@/i18n";
import { fetchEvalContext, type EvalData } from "@/lib/evaluate-context";

/**
 * Computed scores/norms for the evaluated day — the pure-metrics stage of
 * evaluateAthleteDay. No I/O.
 */
export interface EvalMetrics {
  /** Scores of all series days strictly before `date` (baseline history). */
  history: number[];
  baseline: Baseline | null;
  /** Daily sRPE load series + plan over the fetch window. */
  loads: DayLoad[];
  zToday: number | null;
  itemBaselines: Record<string, unknown> | null;
  itemZ: Record<string, number | null> | null;
  scoreNorm: RollingNorm | null;
  growthPct: number | null;
  growthVelocity: number | null;
}

/**
 * Stage 2 — derive baseline, daily loads, rolling z-score norms and growth
 * metrics from the fetched context. Pure computation, gated by the same
 * feature flags as before.
 */
export function computeEvalMetrics(ctx: EvalData): EvalMetrics {
  const { date, from, series, checkins, todayCheckin } = ctx;

  // Baseline: earliest window of daily scores (first 14 days with data).
  const history = series.filter((d) => d.date < date).map((d) => d.score);
  const baseline = computeBaseline(
    series.slice(0, 14).map((d) => d.score),
  );

  // Daily load series (sRPE x minutes) + plan from the group schedule.
  const loads = dailyLoads(
    dateRange(from, date),
    ctx.sessionInputs,
    ctx.schedules,
    ctx.planOverrides,
  );

  // ---- Phase 4: growth & maturation (%PAH band / velocity) ----
  let growthPct: number | null = null;
  let growthVelocityValue: number | null = null;
  if (ctx.growthEnabled) {
    const ath = ctx.athleteRow;
    const ms = ctx.growthRows.slice().reverse();
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
  let scoreNorm: RollingNorm | null = null;
  if (ctx.zscoreEnabled) {
    const from28 = addDays(date, -ROLLING_WINDOW_DAYS);
    // Sick days are excluded from the norm when the 'events' flag is on —
    // an illness week must not drag the personal baseline down.
    const illness = (ctx.eventsEnabled ? ctx.illnessRows : []).map(
      (e) => [e.start_date, e.end_date] as const,
    );
    const sick = (d: string) => illness.some(([a, b]) => d >= a && d <= b);
    const window28 = checkins.filter(
      (c) => c.checkin_date >= from28 && c.checkin_date < date && !sick(c.checkin_date),
    );
    const normScores = series
      .filter((d) => d.date >= from28 && d.date < date && !sick(d.date))
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

  return {
    history,
    baseline,
    loads,
    zToday,
    itemBaselines,
    itemZ,
    scoreNorm,
    growthPct,
    growthVelocity: growthVelocityValue,
  };
}

/**
 * Stage 3 — upsert today's readiness snapshot when a morning check-in exists.
 * Returns whether a snapshot was written.
 */
export async function writeSnapshot(
  admin: SupabaseClient,
  ctx: EvalData,
  metrics: EvalMetrics,
): Promise<boolean> {
  if (!ctx.todayCheckin) return false;
  const snap = buildSnapshot(ctx.todayCheckin, metrics.history, 1, ctx.postByDate.get(ctx.date));
  await admin.from("readiness_snapshots").upsert(
    {
      athlete_id: ctx.athleteId,
      snapshot_date: ctx.date,
      calculated_at: new Date().toISOString(),
      ...snap,
      z_score: metrics.zToday,
      score_norm: metrics.scoreNorm,
      item_baselines: metrics.itemBaselines,
      item_zscores: metrics.itemZ,
    },
    { onConflict: "athlete_id,snapshot_date" },
  );
  return true;
}

/**
 * Pure part of the alerts stage — run the rule engine over the context and
 * metrics. Separated from `runAlerts` so recommendations can inspect the
 * candidates before the record_alert writes happen (original write order).
 */
export function evaluateAlertCandidates(
  ctx: EvalData,
  metrics: EvalMetrics,
): AlertCandidate[] {
  return evaluateAlerts({
    athleteId: ctx.athleteId,
    today: ctx.date,
    timezone: ctx.timezone,
    checkin: ctx.todayCheckin,
    recentCheckins: ctx.checkins.filter(
      (c) => c.checkin_date >= addDays(ctx.date, -14),
    ),
    dailyReadiness: ctx.series,
    baseline: metrics.baseline,
    postCheckins: ctx.postsAll,
    rules: ctx.rules,
    loads: metrics.loads,
    loadEnabled: ctx.loadEnabled,
    zToday: metrics.zToday,
    scoreNorm: metrics.scoreNorm,
    zscoreEnabled: ctx.zscoreEnabled,
    growthPct: metrics.growthPct,
    growthVelocity: metrics.growthVelocity,
    growthEnabled: ctx.growthEnabled,
  });
}

/**
 * Stage 5 — coach recommendations (flag 'recommendations'). Needs the alert
 * candidates for the acute_pain input, so it runs after the rule engine but
 * before the alert writes.
 */
export async function runRecommendations(
  admin: SupabaseClient,
  ctx: EvalData,
  metrics: EvalMetrics,
  candidates: AlertCandidate[],
): Promise<void> {
  const recsEnabled = flagEnabled(ctx.flagRows, "recommendations", ctx.groupIds);
  if (!recsEnabled) return;
  const acwr = acwrEwma(metrics.loads.map((d) => d.load));
  const candidates2 = evaluateRecommendations({
    z: ctx.zscoreEnabled ? metrics.zToday : null,
    acwr: ctx.loadEnabled ? (acwr?.ratio ?? null) : null,
    itemZ: metrics.itemZ,
    acutePain: candidates.some((c) => c.rule_code === "acute_pain"),
    ostrcSubstantial: ctx.ostrcSubstantial,
    growthPct: metrics.growthPct,
  });
  const activeKeys = new Set<string>(candidates2.map((r) => r.rule_key));
  const { data: existingRecs } = await admin
    .from("recommendations")
    .select("id, rule_key, coach_decision")
    .eq("athlete_id", ctx.athleteId)
    .eq("rec_date", ctx.date);
  const staleIds = ((existingRecs as { id: string; rule_key: string; coach_decision: string | null }[] | null) ?? [])
    .filter((r) => !r.coach_decision && !activeKeys.has(r.rule_key))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    await admin.from("recommendations").delete().in("id", staleIds);
  }
  if (candidates2.length > 0) {
    await admin.from("recommendations").upsert(
      candidates2.map((r) => ({
        athlete_id: ctx.athleteId,
        rec_date: ctx.date,
        rule_key: r.rule_key,
        severity: r.severity,
        inputs: r.inputs,
      })),
      { onConflict: "athlete_id,rec_date,rule_key", ignoreDuplicates: true },
    );
  }
}

/**
 * Stage 4 — persist the precomputed alert candidates via the record_alert
 * RPC (deduplicated by dedup_key, so re-evaluation is safe).
 */
export async function runAlerts(
  admin: SupabaseClient,
  ctx: EvalData,
  candidates: AlertCandidate[],
): Promise<void> {
  for (const a of candidates) {
    await admin.rpc("record_alert", {
      p_athlete_id: ctx.athleteId,
      p_rule_code: a.rule_code,
      p_severity: a.severity,
      p_evidence: a.evidence,
      p_recommendation: a.recommendation,
      p_dedup_key: a.dedup_key,
      p_source_checkin_id: a.source_checkin_id,
    });
  }
}

/**
 * Stage 6 — notify coaches about every new alert: bell entry + web push.
 * The notification dedup_key mirrors the alert dedup_key, so a push is sent
 * only the first time a given alert fires for a given coach.
 */
export async function notifyCoaches(
  admin: SupabaseClient,
  ctx: EvalData,
  candidates: AlertCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;
  const pushEnabled = flagEnabled(ctx.flagRows, "push", ctx.groupIds);
  const [{ data: coaches }, { data: athProfile }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, preferred_language")
      .in("role", ["coach", "admin"]),
    admin
      .from("profiles")
      .select("display_name")
      .eq("id", ctx.athleteRow?.profile_id ?? "")
      .maybeSingle(),
  ]);
  const athleteName = athProfile?.display_name ?? ctx.athleteRow?.athlete_code ?? "";
  for (const c of coaches ?? []) {
    const lang = c.preferred_language ?? "ru";
    const t = ALERT_PUSH_TITLES[lang] ?? ALERT_PUSH_TITLES.ru;
    const ruleNames = getDictionary(lang).rules.items as Record<
      string,
      { name: string }
    >;
    for (const a of candidates) {
      const title = a.severity === "priority" ? t.priority : t.regular;
      const body = `${athleteName} — ${ruleNames[a.rule_code]?.name ?? a.rule_code}`;
      const { data: ins } = await admin
        .from("notifications")
        .upsert(
          {
            profile_id: c.id,
            kind: a.severity === "priority" ? "priority_alert" : "alert",
            title,
            body,
            data: { athlete_id: ctx.athleteId, rule: a.rule_code },
            dedup_key: `notif:${c.id}:${a.dedup_key}`,
          },
          { onConflict: "dedup_key", ignoreDuplicates: true },
        )
        .select("id");
      if (ins?.length && pushEnabled) {
        const { sendPushToProfile } = await import("@/lib/push");
        await sendPushToProfile(admin, c.id, {
          title,
          body,
          url: "/coach/alerts",
        });
      }
    }
  }
}

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
  const ctx = await fetchEvalContext(admin, athleteId, date, timezone);
  const metrics = computeEvalMetrics(ctx);
  const snapshotWritten = await writeSnapshot(admin, ctx, metrics);
  const candidates = evaluateAlertCandidates(ctx, metrics);
  await runRecommendations(admin, ctx, metrics, candidates);
  await runAlerts(admin, ctx, candidates);
  await notifyCoaches(admin, ctx, candidates);

  return { snapshotWritten, alerts: candidates.length };
}
