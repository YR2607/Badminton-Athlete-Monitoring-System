import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { todayInTz, addDays } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import { dayStatuses } from "@/lib/checkins";
import { plannedForDate, type PlanOverride } from "@/lib/load";
import { TrainingForm } from "@/components/forms/training-form";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import type { PostTrainingCheckin, TrainingSchedule } from "@/lib/types";

export default async function TrainingPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const yesterday = addDays(today, -1);

  const [{ data: posts }, { data: membership }] = await Promise.all([
    supabase
      .from("post_training_checkins")
      .select("id, submitted_at")
      .eq("athlete_id", athlete.id)
      .gte("submitted_at", `${addDays(today, -1)}T00:00:00Z`),
    supabase
      .from("group_memberships")
      .select("group_id")
      .eq("athlete_id", athlete.id)
      .is("left_at", null)
      .limit(1)
      .maybeSingle(),
  ]);

  const groupId = membership?.group_id ?? null;
  const [srpe, { data: schedules }, { data: planOverrides }] = await Promise.all([
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
  ]);

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

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">{dict.postTraining.sessionTitle}</h1>
        <p className="text-sm text-muted">{today}</p>
      </div>

      {doneToday && (
        <Card>
          <CardContent className="flex items-center gap-2 pt-4 text-sm font-medium">
            <CheckCircle2 className="text-ok" size={20} />
            {dict.athleteHome.postDone}
          </CardContent>
        </Card>
      )}

      <TrainingForm
        dict={dict}
        srpe={srpe}
        defaultMinutes={defaultMinutes}
        allowYesterday={yesterdayPlan.scheduled}
      />
    </div>
  );
}
