import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { addDays, localDate, todayInTz } from "@/lib/dates";
import { TrainingForm } from "@/components/forms/training-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TrainingSession } from "@/lib/types";

export default async function TrainingPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);

  const [{ data: sessions }, { data: posts }] = await Promise.all([
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", athlete.id)
      .gte("started_at", `${addDays(today, -2)}T00:00:00Z`)
      .order("started_at", { ascending: false }),
    supabase
      .from("post_training_checkins")
      .select("training_session_id")
      .eq("athlete_id", athlete.id)
      .gte("submitted_at", `${today}T00:00:00`),
  ]);

  const todaySessions = ((sessions as TrainingSession[]) ?? []).filter(
    (s) => localDate(new Date(s.started_at), profile.timezone) === today,
  );
  const doneIds = new Set((posts ?? []).map((p) => p.training_session_id));

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">{dict.postTraining.sessionTitle}</h1>
        <p className="text-sm text-muted">{today}</p>
      </div>

      {todaySessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.athleteHome.trainingsToday}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {todaySessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {s.started_at.slice(11, 16)} · {dict.postTraining.types[s.training_type]} ·{" "}
                    {s.duration_minutes} {dict.common.minutes} · RPE {s.session_rpe}
                  </span>
                  <Badge tone={doneIds.has(s.id) ? "ok" : "warn"}>
                    {doneIds.has(s.id) ? "✓" : "…"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <TrainingForm dict={dict} />
    </div>
  );
}
