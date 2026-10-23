import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { todayInTz } from "@/lib/dates";
import { MorningForm } from "@/components/forms/morning-form";
import { Card, CardContent } from "@/components/ui/card";
import type { MorningCheckin } from "@/lib/types";

export default async function MorningPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const { data: existing } = await supabase
    .from("morning_checkins")
    .select("*")
    .eq("athlete_id", athlete.id)
    .eq("checkin_date", today)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold">{dict.morning.title}</h1>
      <p className="mb-4 text-sm text-muted">{dict.morning.subtitle}</p>
      {existing ? (
        <>
          <Card className="mb-4">
            <CardContent className="pt-4 text-sm text-muted">
              {dict.morning.alreadyFilled} — {dict.common.edit.toLowerCase()}:
            </CardContent>
          </Card>
          <MorningForm dict={dict} checkinDate={today} existing={existing as MorningCheckin} />
        </>
      ) : (
        <MorningForm dict={dict} checkinDate={today} />
      )}
    </div>
  );
}
