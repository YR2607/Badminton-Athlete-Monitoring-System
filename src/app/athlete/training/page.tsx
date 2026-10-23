import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { localDate, todayInTz } from "@/lib/dates";
import { TrainingForm } from "@/components/forms/training-form";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import type { PostTrainingCheckin } from "@/lib/types";

export default async function TrainingPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);

  const { data: posts } = await supabase
    .from("post_training_checkins")
    .select("id, submitted_at")
    .eq("athlete_id", athlete.id)
    .gte("submitted_at", `${today}T00:00:00Z`);

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

      <TrainingForm dict={dict} />
    </div>
  );
}
