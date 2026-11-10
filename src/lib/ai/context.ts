import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayInTz } from "@/lib/dates";
import type {
  Alert,
  Attendance,
  FieldTest,
  FieldTestResult,
  GrowthMeasurement,
  MorningCheckin,
  PostTrainingCheckin,
  ReadinessSnapshot,
  TrainingSession,
} from "@/lib/types";

/**
 * AI Context Builder — deterministic aggregation ONLY.
 * Readiness/baseline values are taken verbatim from readiness_snapshots
 * (the canonical pipeline output); nothing is recalculated here.
 * PII minimization: context carries athlete_code, never display_name.
 */

const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : null);

export interface AthleteContext {
  athlete_code: string;
  groups: string[];
  period: { from: string; to: string };
  readiness: {
    latest_score: number | null;
    latest_date: string | null;
    baseline_avg: number | null;
    baseline_sd: number | null;
    z_score: number | null;
    confidence: string | null;
    input_data_count: number | null;
    score_avg_7d: number | null;
    score_avg_prev_7d: number | null;
  };
  wellbeing: {
    checkins: number;
    coverage_pct: number | null;
    sleep_avg: number | null;
    fatigue_avg: number | null;
    soreness_avg: number | null;
    stress_avg: number | null;
    mood_avg: number | null;
  };
  acute: {
    pain_reports_7d: number;
    max_pain_severity_7d: number | null;
    swelling_7d: number;
    movement_limitation_7d: number;
  };
  load: {
    sessions: number;
    total_au: number;
    avg_au_per_session: number | null;
    max_single_session_au: number | null;
    rpe_avg: number | null;
  };
  post_training: {
    checkins: number;
    overall_feeling_avg: number | null;
    leg_fatigue_avg: number | null;
  };
  attendance: { attended: number; absent: number; excused: number; marked_days: number };
  alerts_open: { rule_code: string; severity: string; triggered_at: string }[];
  development: {
    latest_tests: { code: string; value: number; unit: string; date: string }[];
    latest_height_cm: number | null;
    latest_height_date: string | null;
  };
}

export function summarizeAthleteData(input: {
  code: string;
  groups: string[];
  from: string;
  to: string;
  days: number;
  checkins: MorningCheckin[];
  sessions: TrainingSession[];
  posts: PostTrainingCheckin[];
  snapshot: ReadinessSnapshot | null;
  alerts: Alert[];
  attendance: Attendance[];
  testResults: (FieldTestResult & { test: FieldTest | null })[];
  growth: GrowthMeasurement[];
}): AthleteContext {
  const ck = input.checkins;
  const recent7 = ck.filter((c) => c.checkin_date >= addDays(input.to, -6));
  const prev7 = ck.filter(
    (c) => c.checkin_date >= addDays(input.to, -13) && c.checkin_date <= addDays(input.to, -7),
  );
  // Raw wellness proxy: mean of the five 1-10 check-in components —
  // labelled as wellness, NOT the canonical readiness score.
  const wellness = (c: MorningCheckin) =>
    (c.sleep_score + c.recovery_score + (11 - c.fatigue_score) + (11 - c.muscle_soreness_score) + c.mood_score) / 5;
  const acute7 = recent7.filter((c) => c.pain_status && c.pain_status !== "none");
  const snap = input.snapshot;
  const loads = input.sessions.map((s) => s.session_load ?? 0).filter((x) => x > 0);

  return {
    athlete_code: input.code,
    groups: input.groups,
    period: { from: input.from, to: input.to },
    readiness: {
      latest_score: snap?.readiness_score ?? null,
      latest_date: snap?.snapshot_date ?? null,
      baseline_avg: snap?.baseline_avg ?? null,
      baseline_sd: snap?.baseline_sd ?? null,
      z_score: snap?.z_score ?? null,
      confidence: snap?.confidence ?? null,
      input_data_count: snap?.input_data_count ?? null,
      score_avg_7d: avg(recent7.map(wellness)),
      score_avg_prev_7d: avg(prev7.map(wellness)),
    },
    wellbeing: {
      checkins: ck.length,
      coverage_pct: pct(ck.length, input.days),
      sleep_avg: avg(ck.map((c) => c.sleep_score)),
      fatigue_avg: avg(ck.map((c) => c.fatigue_score)),
      soreness_avg: avg(ck.map((c) => c.muscle_soreness_score)),
      stress_avg: avg(ck.map((c) => c.stress_score)),
      mood_avg: avg(ck.map((c) => c.mood_score)),
    },
    acute: {
      pain_reports_7d: acute7.length,
      max_pain_severity_7d: acute7.length
        ? Math.max(...acute7.map((c) => c.pain_severity ?? 0)) || null
        : null,
      swelling_7d: recent7.filter((c) => c.swelling).length,
      movement_limitation_7d: recent7.filter((c) => c.movement_limitation).length,
    },
    load: {
      sessions: input.sessions.length,
      total_au: round1(loads.reduce((a, b) => a + b, 0)),
      avg_au_per_session: avg(loads),
      max_single_session_au: loads.length ? Math.max(...loads) : null,
      rpe_avg: avg(input.sessions.map((s) => s.session_rpe).filter((x): x is number => x != null)),
    },
    post_training: {
      checkins: input.posts.length,
      overall_feeling_avg: avg(input.posts.map((p) => p.overall_feeling)),
      leg_fatigue_avg: avg(input.posts.map((p) => p.leg_fatigue)),
    },
    attendance: {
      attended: input.attendance.filter((a) => a.status === "present").length,
      absent: input.attendance.filter((a) => a.status === "absent").length,
      excused: input.attendance.filter((a) => a.status === "excused").length,
      marked_days: input.attendance.length,
    },
    alerts_open: input.alerts.map((a) => ({
      rule_code: a.rule_code,
      severity: a.severity,
      triggered_at: a.triggered_at.slice(0, 10),
    })),
    development: {
      latest_tests: input.testResults.slice(0, 6).map((r) => ({
        code: r.test?.code ?? "test",
        value: r.value,
        unit: r.test?.unit ?? "",
        date: r.test_date,
      })),
      latest_height_cm: input.growth[0]?.height_cm ?? null,
      latest_height_date: input.growth[0]?.measured_on ?? null,
    },
  };
}

export interface GroupContext {
  group_name: string;
  period: { from: string; to: string };
  athletes: number;
  with_checkins_14d: number;
  checkin_coverage_avg_pct: number | null;
  wellness_avg_7d: number | null;
  open_alerts: { priority: number; review_load: number; attention: number; normal: number };
  athletes_with_acute_7d: number;
  sessions_14d: number;
  total_au_14d: number;
}

/** Team-level aggregate over per-athlete contexts (still deterministic). */
export function summarizeGroup(name: string, ctxs: AthleteContext[]): GroupContext {
  const sev = { priority: 0, review_load: 0, attention: 0, normal: 0 };
  for (const c of ctxs)
    for (const a of c.alerts_open)
      if (a.severity in sev) sev[a.severity as keyof typeof sev]++;
  return {
    group_name: name,
    period: ctxs[0]?.period ?? { from: "", to: "" },
    athletes: ctxs.length,
    with_checkins_14d: ctxs.filter((c) => c.wellbeing.checkins > 0).length,
    checkin_coverage_avg_pct: avg(
      ctxs.map((c) => c.wellbeing.coverage_pct).filter((x): x is number => x != null),
    ),
    wellness_avg_7d: avg(
      ctxs.map((c) => c.readiness.score_avg_7d).filter((x): x is number => x != null),
    ),
    open_alerts: sev,
    athletes_with_acute_7d: ctxs.filter((c) => c.acute.pain_reports_7d > 0).length,
    sessions_14d: ctxs.reduce((a, c) => a + c.load.sessions, 0),
    total_au_14d: round1(ctxs.reduce((a, c) => a + c.load.total_au, 0)),
  };
}

/** Fetch all source rows and build the athlete context (server-side only). */
export async function fetchAthleteContext(
  supabase: SupabaseClient,
  athleteId: string,
  tz: string,
  days = 14,
): Promise<AthleteContext | null> {
  const to = todayInTz(tz);
  const from = addDays(to, -(days - 1));
  const since40 = addDays(to, -40);

  const [
    { data: athlete },
    { data: memberships },
    { data: checkins },
    { data: sessions },
    { data: posts },
    { data: snaps },
    { data: alerts },
    { data: attendance },
    { data: testResults },
    { data: tests },
    { data: growth },
  ] = await Promise.all([
    supabase.from("athletes").select("athlete_code,status").eq("id", athleteId).maybeSingle(),
    supabase
      .from("group_memberships")
      .select("group:groups(name)")
      .eq("athlete_id", athleteId)
      .is("left_at", null),
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("checkin_date", since40)
      .order("checkin_date", { ascending: false }),
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("started_at", `${since40}T00:00:00Z`),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("submitted_at", `${since40}T00:00:00Z`),
    supabase
      .from("readiness_snapshots")
      .select("*")
      .eq("athlete_id", athleteId)
      .lte("snapshot_date", to)
      .order("snapshot_date", { ascending: false })
      .limit(1),
    supabase.from("alerts").select("*").eq("athlete_id", athleteId).eq("status", "open"),
    supabase
      .from("attendance")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("att_date", addDays(to, -30)),
    supabase
      .from("field_test_results")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("test_date", { ascending: false })
      .limit(20),
    supabase.from("field_tests").select("*").eq("active", true),
    supabase
      .from("growth_measurements")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("measured_on", { ascending: false })
      .limit(3),
  ]);
  if (!athlete) return null;

  const testById = new Map(((tests as FieldTest[]) ?? []).map((t) => [t.id, t]));
  const inRange = (d: string) => d >= from && d <= to;
  const ck = ((checkins as MorningCheckin[]) ?? []).filter((c) => inRange(c.checkin_date));
  const ss = ((sessions as TrainingSession[]) ?? []).filter(
    (s) => s.started_at.slice(0, 10) >= from,
  );
  const ps = ((posts as PostTrainingCheckin[]) ?? []).filter(
    (p) => p.submitted_at.slice(0, 10) >= from,
  );

  return summarizeAthleteData({
    code: athlete.athlete_code,
    groups: ((memberships as { group: { name: string } | { name: string }[] | null }[]) ?? [])
      .map((m) => (Array.isArray(m.group) ? m.group[0]?.name : m.group?.name))
      .filter((x): x is string => Boolean(x)),
    from,
    to,
    days,
    checkins: ck,
    sessions: ss,
    posts: ps,
    snapshot: ((snaps as ReadinessSnapshot[]) ?? [])[0] ?? null,
    alerts: (alerts as Alert[]) ?? [],
    attendance: (attendance as Attendance[]) ?? [],
    testResults: ((testResults as FieldTestResult[]) ?? []).map((r) => ({
      ...r,
      test: testById.get(r.test_id) ?? null,
    })),
    growth: (growth as GrowthMeasurement[]) ?? [],
  });
}
