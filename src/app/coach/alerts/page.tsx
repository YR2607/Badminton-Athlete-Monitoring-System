import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { scopedAthleteIds } from "@/lib/coach-data";
import { AlertList } from "@/app/coach/athletes/[id]/alert-list";
import type { Alert, Athlete, Profile } from "@/lib/types";

export default async function CoachAlertsPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const ids = await scopedAthleteIds(supabase);

  const [{ data: alerts }, { data: athletes }] = ids.length
    ? await Promise.all([
        supabase
          .from("alerts")
          .select("*")
          .in("athlete_id", ids)
          .order("triggered_at", { ascending: false })
          .limit(100),
        supabase.from("athletes").select("id, athlete_code, profile_id").in("id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  const profileIds = ((athletes as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? []).map(
    (a) => a.profile_id,
  );
  const { data: profs } = profileIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", profileIds)
    : { data: [] as Pick<Profile, "id" | "display_name">[] };
  const nameByProfile = new Map((profs ?? []).map((p) => [p.id, p.display_name]));

  const options = ((athletes as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? [])
    .map((a) => ({ id: a.id, name: nameByProfile.get(a.profile_id) ?? a.athlete_code }))
    .sort((x, y) => x.name.localeCompare(y.name));

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.alerts.title}</h1>
      <AlertList alerts={(alerts as Alert[]) ?? []} dict={dict} athletes={options} />
    </div>
  );
}
