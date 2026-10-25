import type { SupabaseClient } from "@supabase/supabase-js";
import { dailyConditionSeries, postsByLocalDate } from "@/lib/readiness";
import { flagEnabled } from "@/lib/flags";
import { addDays, localDate, localDayUtcBounds } from "@/lib/dates";
import { sessionDateByIdMap } from "@/lib/checkins";
import type { PlanOverride, ScheduleInput, SessionInput } from "@/lib/load";
import type {
  AlertRule,
  Athlete,
  FeatureFlag,
  GrowthMeasurement,
  MorningCheckin,
  PostTrainingCheckin,
  TrainingSchedule,
  TrainingSession,
} from "@/lib/types";

/**
 * Everything evaluateAthleteDay needs from the database plus the derived
 * day-bucketed series. Fetch/reshape stage only — no writes, no scoring.
 */
export interface EvalData {
  athleteId: string;
  /** Athlete-local date being evaluated (YYYY-MM-DD). */
  date: string;
  timezone: string;
  /** Start of the 40-day fetch window (athlete-local date, inclusive). */
  from: string;
  checkins: MorningCheckin[];
  todayCheckin: MorningCheckin | null;
  /** Post check-ins in the window (local day >= from), unsorted raw rows. */
  postsAll: PostTrainingCheckin[];
  /** Post check-ins bucketed to athlete-local days; latest wins. */
  postEntries: { date: string; post: PostTrainingCheckin }[];
  postByDate: Map<string, PostTrainingCheckin>;
  /** Sessions mapped to sRPE inputs on their athlete-local date. */
  sessionInputs: SessionInput[];
  schedules: ScheduleInput[];
  planOverrides: PlanOverride[];
  rules: AlertRule[];
  athleteRow: Athlete | null;
  growthRows: GrowthMeasurement[];
  illnessRows: { start_date: string; end_date: string }[];
  flagRows: FeatureFlag[];
  groupId: string | null;
  groupIds: string[];
  loadEnabled: boolean;
  zscoreEnabled: boolean;
  growthEnabled: boolean;
  eventsEnabled: boolean;
  /** Daily condition series over the window, ascending by date. */
  series: { date: string; score: number }[];
}

/**
 * Fetch every row evaluateAthleteDay reads and bucket them to athlete-local
 * days. All queries run with the service-role client; shapes and filters are
 * identical to the previous monolithic implementation.
 */
export async function fetchEvalContext(
  admin: SupabaseClient,
  athleteId: string,
  date: string,
  timezone: string,
): Promise<EvalData> {
  const from = addDays(date, -40);
  // The fetch window must cover the athlete-local `from` date entirely —
  // a UTC-midnight bound silently drops the first local hours of the window.
  const windowStart = localDayUtcBounds(from, timezone).start.toISOString();

  const [{ data: checkins }, { data: post }, { data: rules }, { data: sessions }, { data: membership }, { data: flags }, { data: athleteRow }, { data: growthRows }, { data: illnessRows }] =
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
      admin
        .from("calendar_events")
        .select("start_date, end_date, kind")
        .eq("athlete_id", athleteId)
        .eq("kind", "illness")
        .gte("end_date", from),
    ]);

  const groupId = membership?.group_id ?? null;
  const [{ data: schedules }, { data: planOverrides }] = groupId
    ? await Promise.all([
        admin
          .from("training_schedules")
          .select("weekday, planned_minutes, planned_rpe")
          .eq("group_id", groupId)
          .eq("active", true),
        admin
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
          .eq("group_id", groupId)
          .gte("plan_date", from)
          .lte("plan_date", date),
      ])
    : [{ data: null }, { data: null }];

  // Check-ins are bucketed by the session's local date, not submitted_at —
  // a backfilled questionnaire belongs to the day it describes.
  const sessionDateById = sessionDateByIdMap(
    (sessions as TrainingSession[] | null) ?? [],
    timezone,
  );

  const checkinRows = (checkins as MorningCheckin[] | null) ?? [];
  const todayCheckin = checkinRows.find((c) => c.checkin_date === date) ?? null;

  // Post-training check-ins bucketed to athlete-local days; latest wins.
  const postsAll = ((post as PostTrainingCheckin[]) ?? []).filter(
    (p) => localDate(new Date(p.submitted_at), timezone) >= from,
  );
  const postEntries = postsByLocalDate(postsAll, timezone, sessionDateById);
  const postByDate = new Map(postEntries.map((e) => [e.date, e.post]));

  const series = dailyConditionSeries(checkinRows, postEntries);

  const sessionInputs: SessionInput[] = ((sessions as TrainingSession[] | null) ?? []).map(
    (s) => ({
      date: sessionDateById.get(s.id)!,
      rpe: s.session_rpe,
      minutes: s.duration_minutes,
    }),
  );

  const flagRows = (flags as FeatureFlag[] | null) ?? [];
  const groupIds = groupId ? [groupId] : [];

  return {
    athleteId,
    date,
    timezone,
    from,
    checkins: checkinRows,
    todayCheckin,
    postsAll,
    postEntries,
    postByDate,
    sessionInputs,
    schedules: ((schedules as TrainingSchedule[] | null) ?? []) as ScheduleInput[],
    planOverrides: (planOverrides as PlanOverride[] | null) ?? [],
    rules: (rules as AlertRule[]) ?? [],
    athleteRow: (athleteRow as Athlete | null) ?? null,
    growthRows: (growthRows as GrowthMeasurement[] | null) ?? [],
    illnessRows: (illnessRows as { start_date: string; end_date: string }[] | null) ?? [],
    flagRows,
    groupId,
    groupIds,
    loadEnabled: flagEnabled(flagRows, "srpe", groupIds),
    zscoreEnabled: flagEnabled(flagRows, "zscore_baseline", groupIds),
    growthEnabled: flagEnabled(flagRows, "growth", groupIds),
    eventsEnabled: flagEnabled(flagRows, "events", groupIds),
    series,
  };
}
