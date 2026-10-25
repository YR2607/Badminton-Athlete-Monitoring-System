import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz, addDays, localDate } from "@/lib/dates";
import { plannedForDate, type PlanOverride } from "@/lib/load";
import {
  computeBaseline,
  dailyConditionSeries,
  postsByLocalDate,
  type Baseline,
} from "@/lib/readiness";
import { dayStatuses, sessionDateByIdMap, sessionLocalDates } from "@/lib/checkins";
import {
  acuteMorningFlags,
  acutePostFlags,
  ageInDays,
  athleteStatus,
  pendingPostCheckins,
  DECLINE_RULES,
  type AthleteStatus,
} from "@/lib/athlete-status";
import type {
  Alert,
  Athlete,
  Group,
  MorningCheckin,
  PostTrainingCheckin,
  Profile,
  TrainingSchedule,
  TrainingSession,
} from "@/lib/types";

export interface CoachAthleteRow {
  athlete: Athlete;
  profile: Profile | null;
  group: Group | null;
  age: number | null;
  /** Athlete's own timezone — every "today" is computed in it, never in the coach's. */
  athleteTz: string;
  /** Athlete-local today (YYYY-MM-DD). */
  today: string;
  status: AthleteStatus;
  todayCheckin: MorningCheckin | null;
  /** Score of today's check-in only; null when no check-in exists today. */
  todayScore: number | null;
  /** Personal norm via the single documented algorithm; null until MIN obs. */
  baseline: Baseline | null;
  /** Days with check-in data in the 40-day baseline window. */
  observations: number;
  /** todayScore − baseline.avg; null unless both exist. */
  readinessDelta: number | null;
  lastCheckinDate: string | null;
  lastKnownScore: number | null;
  lastCheckinAgeDays: number | null;
  openAlerts: Alert[];
  /** Acute red flags in the latest check-ins or a priority alert. */
  acuteSignal: boolean;
  hasPain: boolean;
  sessionsToday: number;
  /** Schedule says a session was due yesterday but none was registered; null when the group has no schedule. */
  scheduledMissedYesterday: boolean | null;
  /** Registered sessions ended >1h ago without a post-training check-in. */
  pendingPostCount: number;
  missedYesterday: boolean;
  /** Last 7 days (oldest → today): morning/evening check-in presence for dots. */
  checkinDots: { date: string; morning: boolean; evening: boolean; hadSession: boolean }[];
  /** Sum of sRPE × minutes over the last 7 athlete-local days (AU). */
  weeklyLoadAu: number;
  series: { date: string; score: number }[];
}

/** All non-archived athletes — coaches and admins see everyone. */
export async function allAthleteIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("athletes").select("id").neq("status", "archived");
  return ((data as { id: string }[] | null) ?? []).map((a) => a.id);
}

/** Athlete ids visible to a staff profile — every staff member sees all athletes. */
export async function scopedAthleteIds(supabase: SupabaseClient): Promise<string[]> {
  return allAthleteIds(supabase);
}

export async function coachDashboard(
  supabase: SupabaseClient,
  tz: string,
): Promise<{ rows: CoachAthleteRow[]; groups: Group[] }> {
  const ids = await scopedAthleteIds(supabase);
  if (ids.length === 0) return { rows: [], groups: [] };
  const coachToday = todayInTz(tz);
  // Check-ins span the full 40-day window used by evaluateAthleteDay so the
  // dashboard baseline is the same algorithm and window as stored snapshots.
  const since40 = addDays(coachToday, -40);
  const since14 = addDays(coachToday, -14);

  const [
    { data: athletes },
    { data: memberships },
    { data: groups },
    { data: checkins },
    { data: sessions },
    { data: posts },
    { data: alerts },
  ] = await Promise.all([
    supabase.from("athletes").select("*").in("id", ids),
    supabase.from("group_memberships").select("*, group:groups(*)").in("athlete_id", ids).is("left_at", null),
    supabase.from("groups").select("*"),
    supabase.from("morning_checkins").select("*").in("athlete_id", ids).gte("checkin_date", since40),
    supabase.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", `${since14}T00:00:00Z`),
    supabase.from("post_training_checkins").select("*").in("athlete_id", ids).gte("submitted_at", `${since14}T00:00:00Z`),
    supabase.from("alerts").select("*").in("athlete_id", ids).eq("status", "open"),
  ]);

  const groupById = new Map(((groups as Group[]) ?? []).map((g) => [g.id, g]));
  const groupOfAthlete = new Map<string, Group>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    const g = groupById.get(m.group_id);
    if (g && !groupOfAthlete.has(m.athlete_id)) groupOfAthlete.set(m.athlete_id, g);
  }

  // Independent follow-up queries in one round-trip batch.
  const profileIds = (athletes as Athlete[] | null)?.map((a) => a.profile_id) ?? [];
  const scopedGroupIds = [...new Set([...groupOfAthlete.values()].map((g) => g.id))];
  const [{ data: profs }, { data: schedules }, { data: planOverrides }] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("*").in("id", profileIds)
      : Promise.resolve({ data: [] as Profile[] }),
    scopedGroupIds.length
      ? supabase
          .from("training_schedules")
          .select("*")
          .in("group_id", scopedGroupIds)
          .eq("active", true)
      : Promise.resolve({ data: [] as TrainingSchedule[] }),
    // Per-date plan overrides — a cancelled day must not flag a missed session.
    // Athlete-local "yesterday" can span two calendar dates across timezones.
    scopedGroupIds.length
      ? supabase
          .from("session_plan_overrides")
          .select("group_id, plan_date, cancelled, planned_minutes, planned_rpe")
          .in("group_id", scopedGroupIds)
          .gte("plan_date", addDays(coachToday, -2))
          .lte("plan_date", coachToday)
      : Promise.resolve({ data: [] as PlanOverride[] }),
  ]);
  const profById = new Map((profs as Profile[] ?? []).map((p) => [p.id, p]));
  const schedulesByGroup = new Map<string, TrainingSchedule[]>();
  for (const s of (schedules as TrainingSchedule[] | null) ?? []) {
    const list = schedulesByGroup.get(s.group_id) ?? [];
    list.push(s);
    schedulesByGroup.set(s.group_id, list);
  }
  const overridesByGroup = new Map<string, PlanOverride[]>();
  for (const o of (planOverrides as (PlanOverride & { group_id: string })[] | null) ?? []) {
    const list = overridesByGroup.get(o.group_id) ?? [];
    list.push(o);
    overridesByGroup.set(o.group_id, list);
  }

  const checkinsByAthlete = new Map<string, MorningCheckin[]>();
  for (const c of (checkins as MorningCheckin[] | null) ?? []) {
    const list = checkinsByAthlete.get(c.athlete_id) ?? [];
    list.push(c);
    checkinsByAthlete.set(c.athlete_id, list);
  }
  const sessionsByAthlete = new Map<string, TrainingSession[]>();
  for (const s of (sessions as TrainingSession[] | null) ?? []) {
    const list = sessionsByAthlete.get(s.athlete_id) ?? [];
    list.push(s);
    sessionsByAthlete.set(s.athlete_id, list);
  }
  const postsByAthlete = new Map<string, PostTrainingCheckin[]>();
  for (const p of (posts as PostTrainingCheckin[] | null) ?? []) {
    const list = postsByAthlete.get(p.athlete_id) ?? [];
    list.push(p);
    postsByAthlete.set(p.athlete_id, list);
  }
  const alertsByAthlete = new Map<string, Alert[]>();
  for (const a of (alerts as Alert[] | null) ?? []) {
    const list = alertsByAthlete.get(a.athlete_id) ?? [];
    list.push(a);
    alertsByAthlete.set(a.athlete_id, list);
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const rows: CoachAthleteRow[] = ((athletes as Athlete[]) ?? []).map((a) => {
    const athleteTz = profById.get(a.profile_id)?.timezone ?? tz;
    const today = todayInTz(athleteTz);
    const yesterday = addDays(today, -1);

    const list = (checkinsByAthlete.get(a.id) ?? []).sort((x, y) =>
      x.checkin_date.localeCompare(y.checkin_date),
    );
    const aSessions = sessionsByAthlete.get(a.id) ?? [];
    const aPosts = postsByAthlete.get(a.id) ?? [];
    const aSessionDateById = sessionDateByIdMap(aSessions, athleteTz);
    const postEntries = postsByLocalDate(aPosts, athleteTz, aSessionDateById);
    const postByDate = new Map(postEntries.map((e) => [e.date, e.post]));
    const aSessionDates = sessionLocalDates(aSessions, athleteTz);
    const series = dailyConditionSeries(list, postEntries);

    const todayC = list.find((c) => c.checkin_date === today) ?? null;
    const todayScore = series.find((s) => s.date === today)?.score ?? null;
    // Single documented baseline algorithm: earliest ≤14 days with data,
    // requires MIN_BASELINE_OBSERVATIONS — identical to evaluateAthleteDay.
    const baseline = computeBaseline(series.slice(0, 14).map((d) => d.score));
    const observations = list.length;
    const readinessDelta =
      todayScore !== null && baseline !== null
        ? Math.round((todayScore - baseline.avg) * 10) / 10
        : null;

    const lastC = [...list].reverse().find((c) => c.checkin_date <= today) ?? null;
    const lastKnownScore = lastC
      ? (series.find((s) => s.date === lastC.checkin_date)?.score ?? null)
      : null;
    const lastCheckinAgeDays = lastC ? ageInDays(lastC.checkin_date, today) : null;

    const openAlerts = alertsByAthlete.get(a.id) ?? [];
    const todayPost = postByDate.get(today) ?? null;
    const recentPain =
      list.some((c) => c.checkin_date >= yesterday && c.pain_status !== "none") ||
      postEntries.some(
        (e) => e.date >= yesterday && e.date <= today && e.post.pain_status !== "none",
      );
    const acuteSignal =
      acuteMorningFlags(todayC) ||
      acutePostFlags(todayPost) ||
      openAlerts.some((al) => al.severity === "priority");

    const sessionsToday = aSessions.filter(
      (s) => localDate(new Date(s.started_at), athleteTz) === today,
    ).length;
    const since7 = addDays(today, -6);
    const weeklyLoadAu = aSessions
      .filter((s) => {
        const d = localDate(new Date(s.started_at), athleteTz);
        return d >= since7 && d <= today;
      })
      .reduce(
        (acc, s) =>
          acc + (s.session_rpe != null && s.duration_minutes != null ? s.session_rpe * s.duration_minutes : 0),
        0,
      );
    const group = groupOfAthlete.get(a.id) ?? null;
    const sched = group ? (schedulesByGroup.get(group.id) ?? []) : [];
    const schedOv = (group ? (overridesByGroup.get(group.id) ?? []) : []).filter(
      (o) => o.plan_date === yesterday,
    );
    const scheduledMissedYesterday =
      sched.length === 0 && schedOv.length === 0
        ? null
        : plannedForDate(yesterday, sched, schedOv).scheduled &&
          !aSessionDates.has(yesterday);
    const pendingPostCount = pendingPostCheckins(aSessions, aPosts, now).length;

    const status = athleteStatus({
      hasPrioritySignal: acuteSignal,
      hasDeclineAlert: openAlerts.some((al) => DECLINE_RULES.has(al.rule_code)),
      todayCheckin: todayC,
      todayScore,
      baseline,
      observations,
    });

    return {
      athlete: a,
      profile: profById.get(a.profile_id) ?? null,
      group,
      age: a.birth_year ? year - a.birth_year : null,
      athleteTz,
      today,
      status,
      todayCheckin: todayC,
      todayScore,
      baseline,
      observations,
      readinessDelta,
      lastCheckinDate: lastC?.checkin_date ?? null,
      lastKnownScore,
      lastCheckinAgeDays,
      openAlerts,
      acuteSignal,
      hasPain: recentPain || openAlerts.some((al) => al.severity === "priority"),
      sessionsToday,
      scheduledMissedYesterday,
      pendingPostCount,
      missedYesterday: !list.some((c) => c.checkin_date === yesterday),
      checkinDots: dayStatuses({
        days: Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)),
        checkins: list,
        postEntries,
        sessionDates: aSessionDates,
      }).map((d) => ({
        date: d.date,
        morning: d.morning !== null,
        evening: d.evening !== null,
        hadSession: d.hadSession,
      })),
      weeklyLoadAu,
      series: series.filter((s) => s.date >= since14),
    };
  });

  return { rows, groups: (groups as Group[]) ?? [] };
}
