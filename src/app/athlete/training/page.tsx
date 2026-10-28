import { redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { todayInTz, addDays, localDate } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import { dayStatuses } from "@/lib/checkins";
import { plannedForDate, type PlanOverride } from "@/lib/load";
import { TrainingForm } from "@/components/forms/training-form";
import { Card, CardContent } from "@/components/ui/card";
import { TodayChecklist } from "@/components/today-checklist";
import { getTodaySurveyStatus } from "@/lib/today-surveys";
import { CheckCircle2, Trophy } from "lucide-react";
import type { CalendarEvent, PostTrainingCheckin, TrainingSchedule, TrainingSession } from "@/lib/types";

export default async function TrainingPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const yesterday = addDays(today, -1);

  const [{ data: posts }, { data: memberships }, { data: sessionsTodayRows }] = await Promise.all([
    supabase
      .from("post_training_checkins")
      .select("id, submitted_at")
      .eq("athlete_id", athlete.id)
      .gte("submitted_at", `${addDays(today, -1)}T00:00:00Z`),
    supabase
      .from("group_memberships")
      .select("group_id")
      .eq("athlete_id", athlete.id)
      .is("left_at", null),
    supabase
      .from("training_sessions")
      .select("id, started_at, duration_minutes, match_discipline, match_result")
      .eq("athlete_id", athlete.id)
      .gte("started_at", `${addDays(today, -1)}T00:00:00Z`),
  ]);

  const groupIds = ((memberships as { group_id: string }[] | null) ?? []).map(
    (m) => m.group_id,
  );
  const groupId = groupIds[0] ?? null;
  const [srpe, { data: schedules }, { data: planOverrides }, { data: tournEvents }] = await Promise.all([
    isFlagEnabled("srpe", groupId ? [groupId] : []),
    groupId
      ? supabase
          .from("training_schedules")
          .select("*")
          .eq("group_id", groupId)
          .eq("active", true)
      : Promise.resolve({ data: null }),
    groupId
      ? supabase
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
          .eq("group_id", groupId)
          .in("plan_date", [yesterday, today])
      : Promise.resolve({ data: null }),
    groupId
      ? supabase
          .from("calendar_events")
          .select("*")
          .eq("kind", "tournament")
          .lte("start_date", today)
          .gte("end_date", today)
          .or(`athlete_id.eq.${athlete.id},group_id.eq.${groupId}`)
      : supabase
          .from("calendar_events")
          .select("*")
          .eq("kind", "tournament")
          .eq("athlete_id", athlete.id)
          .lte("start_date", today)
          .gte("end_date", today),
  ]);

  const activeTournament = ((tournEvents as CalendarEvent[] | null) ?? [])[0] ?? null;
  const todaySessions = ((sessionsTodayRows as TrainingSession[] | null) ?? []).filter(
    (s) => localDate(new Date(s.started_at), profile.timezone) === today,
  );
  const totalMinutesToday = todaySessions.reduce((a, s) => a + (s.duration_minutes ?? 0), 0);

  const rows = (schedules as TrainingSchedule[] | null) ?? [];
  const overrides = (planOverrides as PlanOverride[] | null) ?? [];
  const todayPlan = plannedForDate(today, rows, overrides);
  const yesterdayPlan = plannedForDate(yesterday, rows, overrides);
  const defaultMinutes = todayPlan.planned_minutes ?? undefined;

  const [todayStatus] = dayStatuses({
    days: [today],
    posts: (posts as PostTrainingCheckin[]) ?? [],
    tz: profile.timezone,
  });
  const doneToday = todayStatus.evening !== null;

  // Unified checklist — the other questionnaires stay visible here too.
  const surveyStatus = await getTodaySurveyStatus(supabase, {
    athleteId: athlete.id,
    groupIds,
    today,
    tz: profile.timezone,
    academyLevel: athlete.academy_level ?? "beginner",
  });

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">{dict.postTraining.sessionTitle}</h1>
        <p className="text-sm text-muted">{today}</p>
      </div>

      {activeTournament && (
        <div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm font-medium">
          <Trophy size={18} className="shrink-0 text-accent" />
          <span>{dict.pro.tournamentBanner.replace("{name}", activeTournament.title)}</span>
        </div>
      )}

      {doneToday && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm font-medium">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="text-ok" size={20} />
              {dict.athleteHome.postDone}
            </span>
            {todaySessions.length > 0 && (
              <span className="text-xs text-muted tabular-nums">
                {dict.pro.matchesTodaySummary
                  .replace("{n}", String(todaySessions.length))
                  .replace("{m}", String(totalMinutesToday))}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <TrainingForm
        dict={{
          postTraining: dict.postTraining,
          morning: dict.morning,
          common: dict.common,
          athleteHome: { painNotice: dict.athleteHome.painNotice },
          pro: {
            bodyMapTitle: dict.pro.bodyMapTitle,
            bodyZones: dict.pro.bodyZones,
            focusLabel: dict.pro.focusLabel,
            focusTags: dict.pro.focusTags,
            matchModeToggle: dict.pro.matchModeToggle,
            matchDiscipline: dict.pro.matchDiscipline,
            matchResult: dict.pro.matchResult,
            matchWin: dict.pro.matchWin,
            matchLoss: dict.pro.matchLoss,
          },
        }}
        srpe={srpe}
        defaultMinutes={defaultMinutes}
        allowYesterday={yesterdayPlan.scheduled}
        tournamentMode={Boolean(activeTournament)}
      />

      <TodayChecklist
        d={dict.athleteHome}
        status={surveyStatus}
        exclude="post"
      />
    </div>
  );
}
