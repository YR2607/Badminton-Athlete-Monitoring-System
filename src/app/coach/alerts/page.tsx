import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { scopedAthleteIds } from "@/lib/coach-data";
import { AlertList } from "@/app/coach/athletes/[id]/alert-list";
import type { Alert } from "@/lib/types";

export default async function CoachAlertsPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const ids = await scopedAthleteIds(supabase, profile);

  const { data: alerts } = ids.length
    ? await supabase
        .from("alerts")
        .select("*")
        .in("athlete_id", ids)
        .order("triggered_at", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.alerts.title}</h1>
      <AlertList alerts={(alerts as Alert[]) ?? []} dict={dict} />
    </div>
  );
}
