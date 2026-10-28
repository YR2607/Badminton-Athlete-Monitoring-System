import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { isFlagEnabled } from "@/lib/flags";
import { isoWeekMonday } from "@/lib/ostrc";
import { selectDailyLesson } from "@/lib/academy";
import { dayStatuses, sessionDateByIdMap } from "@/lib/checkins";
import { plannedForDate, type PlanOverride, type ScheduleInput } from "@/lib/load";
import { addDays } from "@/lib/dates";
import type {
  AcademyItem,
  AcademyLevel,
  AcademyResponse,
  MorningCheckin,
  PostTrainingCheckin,
  TodaySurveyStatus,
} from "@/lib/types";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Single source of truth for "what does this athlete still need to fill in
 * today" — used by the athlete home checklist and by the health check-in
 * pages so every pending questionnaire stays visible where kids fill forms.
 */
export async function getTodaySurveyStatus(
  supabase: ServerSupabase,
  opts: {
    athleteId: string;
    groupIds: string[];
    today: string;
    tz: string;
    academyLevel?: AcademyLevel;
  },
): Promise<TodaySurveyStatus> {
  const { athleteId, groupIds, today, tz } = opts;
  const [ostrcOn, academyOn] = await Promise.all([
    isFlagEnabled("ostrc", groupIds),
    isFlagEnabled("academy", groupIds),
  ]);

  const since30 = addDays(today, -29);
  const weekStart = isoWeekMonday(today);
  const admin = academyOn ? createAdminClient() : null;

  const [
    { data: checkinRow },
    { data: postRows },
    { data: sessionRows },
    { data: schedRows },
    { data: overRows },
    { data: consent },
    { data: ostrcWk },
    { data: itemRows },
    { data: respRows },
  ] = await Promise.all([
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteId)
      .eq("checkin_date", today)
      .maybeSingle(),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("submitted_at", `${since30}T00:00:00Z`),
    supabase
      .from("training_sessions")
      .select("id, started_at")
      .eq("athlete_id", athleteId)
      .gte("started_at", `${since30}T00:00:00Z`),
    groupIds.length
      ? supabase
          .from("training_schedules")
          .select("weekday, planned_minutes, planned_rpe")
          .in("group_id", groupIds)
          .eq("active", true)
      : Promise.resolve({ data: [] as ScheduleInput[] }),
    groupIds.length
      ? supabase
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
          .in("group_id", groupIds)
          .eq("plan_date", today)
      : Promise.resolve({ data: [] as PlanOverride[] }),
    ostrcOn
      ? supabase
          .from("consent_records")
          .select("status")
          .eq("athlete_id", athleteId)
          .eq("consent_type", "parental_data_processing")
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ostrcOn
      ? supabase
          .from("ostrc_responses")
          .select("id")
          .eq("athlete_id", athleteId)
          .eq("week_start_date", weekStart)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    admin
      ? admin.from("academy_items").select("*").eq("published", true)
      : Promise.resolve({ data: [] as AcademyItem[] }),
    academyOn
      ? supabase
          .from("academy_responses")
          .select("item_id, assigned_date")
          .eq("athlete_id", athleteId)
      : Promise.resolve({
          data: [] as Pick<AcademyResponse, "item_id" | "assigned_date">[],
        }),
  ]);

  const sessionDateById = sessionDateByIdMap(
    (sessionRows as { id: string; started_at: string }[] | null) ?? [],
    tz,
  );
  const schedInputs = (schedRows as ScheduleInput[] | null) ?? [];
  const overrides = (overRows as PlanOverride[] | null) ?? [];
  const [status] = dayStatuses({
    days: [today],
    checkins: checkinRow ? [checkinRow as MorningCheckin] : [],
    posts: (postRows as PostTrainingCheckin[] | null) ?? [],
    tz,
    sessionDateById,
    scheduledFor: (date) => plannedForDate(date, schedInputs, overrides).scheduled,
  });

  const ostrcEnabled = ostrcOn && consent?.status === "granted";
  const ostrcDone = ((ostrcWk as { id: string }[] | null) ?? []).length > 0;

  const items = (itemRows as AcademyItem[] | null) ?? [];
  const responses =
    (respRows as Pick<AcademyResponse, "item_id" | "assigned_date">[] | null) ?? [];
  const daily = academyOn
    ? selectDailyLesson(items, responses, {
        athleteId,
        today,
        level: opts.academyLevel ?? "beginner",
        groupIds,
      })
    : [];
  const answeredIds = new Set(responses.map((r) => r.item_id));

  return {
    morningDone: status.morning !== null,
    postDone: status.evening !== null,
    scheduledToday: status.scheduled === true,
    ostrcEnabled,
    ostrcDone,
    academyOn,
    academyTotal: daily.length,
    academyDone: daily.filter((i) => answeredIds.has(i.id)).length,
  };
}
