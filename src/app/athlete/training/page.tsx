import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { localDate, todayInTz, addDays } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import { weekdayOf } from "@/lib/load";
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
  const [srpe, { data: schedules }] = await Promise.all([
    isFlagEnabled("srpe", groupId ? [groupId] : []),
    groupId
      ? supabase
          .from("training_schedules")
          .select("*")
          .eq("group_id", groupId)
          .eq("active", true)
      : Promise.resolve({ data: null }),
  ]);

  const rows = (schedules as TrainingSchedule[] | null) ?? [];
  const todayRows = rows.filter((s) => s.weekday === weekdayOf(today));
  const yesterdayRows = rows.filter((s) => s.weekday === weekdayOf(yesterday));
  const defaultMinutes =
    todayRows.find((s) => s.planned_minutes != null)?.planned_minutes ?? undefined;

  const doneToday = ((posts as PostTrainingCheckin[]) ?? []).some(
    (p) => localDate(new Date(p.submitted_at), profile.timezone) === today,
  );

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
        allowYesterday={yesterdayRows.length > 0}
      />
    </div>
  );
}
