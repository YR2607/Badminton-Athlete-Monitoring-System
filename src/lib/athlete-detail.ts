import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dateRange, localDate, resolveRange, todayInTz, type RangeKey } from "@/lib/dates";
import { allAthleteIds } from "@/lib/coach-data";
import { isFlagEnabled } from "@/lib/flags";
import { dailyLoads, type DayLoad, type PlanOverride, type ScheduleInput, type SessionInput } from "@/lib/load";
import { attendanceSummary, type AttendanceSummary } from "@/lib/attendance";
import type {
  Alert,
  Athlete,
  Attendance,
  AttendanceStatus,
  CalendarEvent,
  CoachNote,
  ConsentRecord,
  FieldTest,
  FieldTestResult,
  GrowthMeasurement,
  MorningCheckin,
  OstrcResponse,
  OstrcZone,
  PostTrainingCheckin,
  Profile,
  ReadinessSnapshot,
  Recommendation,
  TrainingSession,
} from "@/lib/types";

/** What the loader needs from the request context (viewer + URL params). */
export interface AthleteDetailCtx {
  /** Viewer's role — coaches get the scoped switcher list. */
  role: Profile["role"];
  /** Fallback timezone when the athlete's own profile has none. */
  timezone: string;
  /** Raw ?range= param; resolved in the athlete's TZ. */
  range?: string;
  /** Raw ?from=/?to= params for range=custom. */
  from?: string;
  to?: string;
}

export interface AthleteMembership {
  group_id: string;
  group?: { name: string } | null;
}

/** Everything src/app/coach/athletes/[id]/page.tsx renders from. */
export interface AthleteDetailData {
  a: Athlete;
  aProfile: Profile | null;
  membership: AthleteMembership | null;
  groupName: string;
  /** Athlete's timezone — every "today"/localDate below uses it. */
  tz: string;
  today: string;
  range: { from: string; to: string };
  navAthletes: { id: string; name: string }[];
  // Feature flags (evaluated for the athlete's current group).
  dashboardOn: boolean;
  srpeOn: boolean;
  zscoreOn: boolean;
  recsOn: boolean;
  eventsOn: boolean;
  ostrcOn: boolean;
  testsOn: boolean;
  growthOn: boolean;
  // Core range + "today" block data.
  checkins: MorningCheckin[] | null;
  sessions: TrainingSession[] | null;
  postCheckins: PostTrainingCheckin[] | null;
  todayCheckin: MorningCheckin | null;
  recentSessions: TrainingSession[] | null;
  recentPosts: PostTrainingCheckin[] | null;
  latestSnap: ReadinessSnapshot | null;
  alerts: Alert[] | null;
  notes: CoachNote[] | null;
  consents: ConsentRecord[] | null;
  // Flag-gated blocks (empty defaults when the flag is off).
  recs: Recommendation[];
  eventRows: CalendarEvent[];
  ostrcZones: OstrcZone[];
  ostrcRows: OstrcResponse[];
  fieldTests: FieldTest[];
  testResults: FieldTestResult[];
  groupMedian: Record<string, number>;
  growthMs: GrowthMeasurement[];
  dashSnaps: ReadinessSnapshot[];
  dashLoads: DayLoad[];
  /** 30-day attendance vs group schedule; null when the athlete has no group. */
  attendanceStats: AttendanceSummary | null;
}

/**
 * All data for the coach athlete-detail page in three stages:
 *  1. athlete row (RLS gate — null means notFound),
 *  2. profile + membership (needed for TZ and group-scoped flags),
 *  3. flags, then ONE batch firing every needed query at once —
 *     dependent chains (switcher list, group-median) run as parallel tasks.
 */
export async function getAthleteDetail(
  supabase: SupabaseClient,
  athleteId: string,
  ctx: AthleteDetailCtx,
): Promise<AthleteDetailData | null> {
  // Stage 1: RLS — returns null unless this athlete is assigned to the coach.
  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("id", athleteId)
    .maybeSingle();
  if (!athlete) return null;
  const a = athlete as Athlete;

  // Stage 2: profile (TZ, display name) + current group membership (flags, group queries).
  const [{ data: aProfile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", a.profile_id).maybeSingle(),
    supabase
      .from("group_memberships")
      .select("group_id, group:groups(name)")
      .eq("athlete_id", a.id)
      .is("left_at", null)
      .maybeSingle(),
  ]);
  const groupId = (membership as AthleteMembership | null)?.group_id ?? null;
  const tz = ((aProfile as Profile | null)?.timezone) ?? ctx.timezone;
  const today = todayInTz(tz);
  const range = resolveRange((ctx.range as RangeKey) || "30d", tz, {
    from: ctx.from,
    to: ctx.to,
  });

  // Flags are cache()-backed — resolve all of them before firing queries.
  const athleteGroupIds = groupId ? [groupId] : [];
  const [dashboardOn, srpeOn, zscoreOn, recsOn, eventsOn, ostrcOn, testsOn, growthOn] =
    await Promise.all([
      isFlagEnabled("athlete_dashboard", athleteGroupIds),
      isFlagEnabled("srpe", athleteGroupIds),
      isFlagEnabled("zscore_baseline", athleteGroupIds),
      isFlagEnabled("recommendations", athleteGroupIds),
      isFlagEnabled("events", athleteGroupIds),
      isFlagEnabled("ostrc", athleteGroupIds),
      isFlagEnabled("field_tests", athleteGroupIds),
      isFlagEnabled("growth", athleteGroupIds),
    ]);
  const dashboardDataOn = dashboardOn && (srpeOn || zscoreOn);
  const since40 = addDays(today, -39);

  // Stage 3 tasks — each is a self-contained sub-graph; all launch together below.

  // Switcher list: 3-deep dependent chain (ids -> athlete rows -> profile names).
  async function navAthletesTask(): Promise<{ id: string; name: string }[]> {
    const navIds = ctx.role === "coach" ? await allAthleteIds(supabase) : null;
    let navQuery = supabase.from("athletes").select("id, athlete_code, profile_id");
    if (navIds)
      navQuery = navQuery.in(
        "id",
        navIds.length ? navIds : ["00000000-0000-0000-0000-000000000000"],
      );
    const { data: navRows } = await navQuery;
    const navProfileIds = (
      (navRows as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? []
    ).map((x) => x.profile_id);
    const { data: navProfiles } = navProfileIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", navProfileIds)
      : { data: [] as { id: string; display_name: string }[] };
    const navNameById = new Map((navProfiles ?? []).map((p) => [p.id, p.display_name]));
    return (((navRows as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? [])
      .map((x) => ({ id: x.id, name: navNameById.get(x.profile_id) ?? x.athlete_code }))
      .sort((x, y) => x.name.localeCompare(y.name)));
  }

  async function recsTask(): Promise<Recommendation[]> {
    if (!recsOn) return [];
    const { data: recRows } = await supabase
      .from("recommendations")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("rec_date", addDays(today, -13))
      .order("rec_date", { ascending: false });
    return (recRows as Recommendation[] | null) ?? [];
  }

  async function eventsTask(): Promise<CalendarEvent[]> {
    if (!eventsOn) return [];
    const evQuery = groupId
      ? supabase
          .from("calendar_events")
          .select("*")
          .or(`athlete_id.eq.${a.id},group_id.eq.${groupId}`)
          .order("start_date", { ascending: false })
          .limit(30)
      : supabase
          .from("calendar_events")
          .select("*")
          .eq("athlete_id", a.id)
          .order("start_date", { ascending: false })
          .limit(30);
    const { data: ev } = await evQuery;
    return (ev as CalendarEvent[] | null) ?? [];
  }

  async function ostrcTask(): Promise<{ ostrcZones: OstrcZone[]; ostrcRows: OstrcResponse[] }> {
    if (!ostrcOn) return { ostrcZones: [], ostrcRows: [] };
    const [{ data: zRows }, { data: oRows }] = await Promise.all([
      supabase.from("ostrc_zones").select("*").eq("active", true).order("sort_order"),
      supabase
        .from("ostrc_responses")
        .select("*")
        .eq("athlete_id", a.id)
        .order("week_start_date", { ascending: false })
        .limit(60),
    ]);
    return {
      ostrcZones: (zRows as OstrcZone[] | null) ?? [],
      ostrcRows: (oRows as OstrcResponse[] | null) ?? [],
    };
  }

  async function fieldTestsTask(): Promise<{
    fieldTests: FieldTest[];
    testResults: FieldTestResult[];
    groupMedian: Record<string, number>;
  }> {
    const groupMedian: Record<string, number> = {};
    if (!testsOn) return { fieldTests: [], testResults: [], groupMedian };
    const [{ data: tRows }, { data: rRows }, { data: mates }] = await Promise.all([
      supabase.from("field_tests").select("*").eq("active", true).order("sort_order"),
      supabase
        .from("field_test_results")
        .select("*")
        .eq("athlete_id", a.id)
        .order("test_date", { ascending: false })
        .limit(200),
      // Independent of the two above — only consumed when a group exists.
      groupId
        ? supabase
            .from("group_memberships")
            .select("athlete_id")
            .eq("group_id", groupId)
            .is("left_at", null)
        : Promise.resolve({ data: null }),
    ]);
    const fieldTests = (tRows as FieldTest[] | null) ?? [];
    const testResults = (rRows as FieldTestResult[] | null) ?? [];

    // Group median per test: latest best value of each group-mate.
    const mateIds = ((mates as { athlete_id: string }[] | null) ?? []).map((m) => m.athlete_id);
    if (mateIds.length) {
      const { data: allRes } = await supabase
        .from("field_test_results")
        .select("athlete_id, test_id, test_date, value")
        .in("athlete_id", mateIds);
      const rows = (allRes as FieldTestResult[] | null) ?? [];
      for (const t of fieldTests) {
        const latestByAthlete = new Map<string, number>();
        const latestDate = new Map<string, string>();
        for (const r of rows.filter((x) => x.test_id === t.id)) {
          const cur = latestDate.get(r.athlete_id);
          if (cur === undefined || r.test_date > cur) {
            latestDate.set(r.athlete_id, r.test_date);
            latestByAthlete.set(r.athlete_id, r.value);
          } else if (r.test_date === cur) {
            const prev = latestByAthlete.get(r.athlete_id)!;
            latestByAthlete.set(
              r.athlete_id,
              t.higher_better ? Math.max(prev, r.value) : Math.min(prev, r.value),
            );
          }
        }
        const vals = [...latestByAthlete.values()].sort((x, y) => x - y);
        if (vals.length) {
          const mid = Math.floor(vals.length / 2);
          groupMedian[t.id] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
        }
      }
    }
    return { fieldTests, testResults, groupMedian };
  }

  async function growthTask(): Promise<GrowthMeasurement[]> {
    if (!growthOn) return [];
    const { data: gRows } = await supabase
      .from("growth_measurements")
      .select("*")
      .eq("athlete_id", a.id)
      .order("measured_on", { ascending: true });
    return (gRows as GrowthMeasurement[]) ?? [];
  }

  async function dashboardTask(): Promise<{ dashSnaps: ReadinessSnapshot[]; dashLoads: DayLoad[] }> {
    if (!dashboardDataOn) return { dashSnaps: [], dashLoads: [] };
    const [{ data: dSnaps }, { data: dSessions }, { data: dSchedules }, { data: dOverrides }] =
      await Promise.all([
        supabase
          .from("readiness_snapshots")
          .select("*")
          .eq("athlete_id", a.id)
          .gte("snapshot_date", addDays(today, -29))
          .order("snapshot_date", { ascending: true }),
        supabase
          .from("training_sessions")
          .select("started_at, session_rpe, duration_minutes")
          .eq("athlete_id", a.id)
          .gte("started_at", `${since40}T00:00:00Z`),
        groupId
          ? supabase
              .from("training_schedules")
              .select("weekday, planned_minutes, planned_rpe")
              .eq("group_id", groupId)
              .eq("active", true)
          : Promise.resolve({ data: null }),
        groupId
          ? supabase
              .from("session_plan_overrides")
              .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
              .eq("group_id", groupId)
              .gte("plan_date", since40)
              .lte("plan_date", today)
          : Promise.resolve({ data: null }),
      ]);
    const dashSnaps = (dSnaps as ReadinessSnapshot[]) ?? [];
    const inputs: SessionInput[] = (
      (dSessions as
        | { started_at: string; session_rpe: number | null; duration_minutes: number | null }[]
        | null) ?? []
    ).map((s) => ({
      date: localDate(new Date(s.started_at), tz),
      rpe: s.session_rpe,
      minutes: s.duration_minutes,
    }));
    const dashLoads = dailyLoads(
      dateRange(since40, today),
      inputs,
      (dSchedules ?? []) as { weekday: number; planned_minutes: number | null; planned_rpe: number | null }[],
      (dOverrides ?? []) as PlanOverride[],
    );
    return { dashSnaps, dashLoads };
  }

  // 30-day attendance: explicit marks + logged sessions vs the group schedule.
  async function attendanceTask(): Promise<AttendanceSummary | null> {
    if (!groupId) return null;
    const since = addDays(today, -29);
    const [{ data: marks }, { data: sch }, { data: ov }, { data: sess }] = await Promise.all([
      supabase
        .from("attendance")
        .select("att_date, status")
        .eq("athlete_id", a.id)
        .gte("att_date", since)
        .lte("att_date", today),
      supabase
        .from("training_schedules")
        .select("weekday, planned_minutes, planned_rpe")
        .eq("group_id", groupId)
        .eq("active", true),
      supabase
        .from("session_plan_overrides")
        .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
        .eq("group_id", groupId)
        .gte("plan_date", since)
        .lte("plan_date", today),
      supabase
        .from("training_sessions")
        .select("started_at")
        .eq("athlete_id", a.id)
        .gte("started_at", `${since}T00:00:00Z`),
    ]);
    const sessionDates = new Set(
      ((sess as { started_at: string }[] | null) ?? []).map((s) =>
        localDate(new Date(s.started_at), tz),
      ),
    );
    const marksMap = new Map<string, AttendanceStatus>(
      ((marks as Pick<Attendance, "att_date" | "status">[] | null) ?? []).map((m) => [
        m.att_date,
        m.status,
      ]),
    );
    return attendanceSummary(
      dateRange(since, today),
      ((sch ?? []) as ScheduleInput[]),
      ((ov ?? []) as PlanOverride[]),
      sessionDates,
      marksMap,
    );
  }

  // One batch: the 10 unconditional queries + every gated task, all concurrent.
  const [
    { data: checkins },
    { data: sessions },
    { data: postCheckins },
    // "Today" block is independent of the selected range — its own window.
    { data: todayCheckin },
    { data: recentSessions },
    { data: recentPosts },
    { data: snapshots },
    { data: alerts },
    { data: notes },
    { data: consents },
    navAthletes,
    recs,
    eventRows,
    { ostrcZones, ostrcRows },
    { fieldTests, testResults, groupMedian },
    growthMs,
    { dashSnaps, dashLoads },
    attendanceStats,
  ] = await Promise.all([
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("checkin_date", addDays(range.from, -30))
      .order("checkin_date"),
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("started_at", `${addDays(range.from, -14)}T00:00:00Z`)
      .order("started_at"),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("submitted_at", `${addDays(range.from, -30)}T00:00:00Z`),
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .eq("checkin_date", today)
      .maybeSingle(),
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("started_at", `${addDays(today, -14)}T00:00:00Z`),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("submitted_at", `${addDays(today, -14)}T00:00:00Z`),
    supabase
      .from("readiness_snapshots")
      .select("*")
      .eq("athlete_id", a.id)
      .order("snapshot_date", { ascending: false })
      .limit(1),
    supabase
      .from("alerts")
      .select("*")
      .eq("athlete_id", a.id)
      .order("triggered_at", { ascending: false })
      .limit(50),
    supabase
      .from("coach_notes")
      .select("*")
      .eq("athlete_id", a.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("consent_records")
      .select("*")
      .eq("athlete_id", a.id)
      .order("recorded_at", { ascending: false }),
    navAthletesTask(),
    recsTask(),
    eventsTask(),
    ostrcTask(),
    fieldTestsTask(),
    growthTask(),
    dashboardTask(),
    attendanceTask(),
  ]);

  return {
    a,
    aProfile: (aProfile as Profile | null) ?? null,
    membership: (membership as AthleteMembership | null) ?? null,
    groupName: (membership as { group?: { name: string } } | null)?.group?.name ?? "—",
    tz,
    today,
    range,
    navAthletes,
    dashboardOn,
    srpeOn,
    zscoreOn,
    recsOn,
    eventsOn,
    ostrcOn,
    testsOn,
    growthOn,
    checkins: (checkins as MorningCheckin[] | null) ?? null,
    sessions: (sessions as TrainingSession[] | null) ?? null,
    postCheckins: (postCheckins as PostTrainingCheckin[] | null) ?? null,
    todayCheckin: (todayCheckin as MorningCheckin | null) ?? null,
    recentSessions: (recentSessions as TrainingSession[] | null) ?? null,
    recentPosts: (recentPosts as PostTrainingCheckin[] | null) ?? null,
    latestSnap: (snapshots as ReadinessSnapshot[] | null)?.[0] ?? null,
    alerts: (alerts as Alert[] | null) ?? null,
    notes: (notes as CoachNote[] | null) ?? null,
    consents: (consents as ConsentRecord[] | null) ?? null,
    recs,
    eventRows,
    ostrcZones,
    ostrcRows,
    fieldTests,
    testResults,
    groupMedian,
    growthMs,
    dashSnaps,
    dashLoads,
    attendanceStats,
  };
}
