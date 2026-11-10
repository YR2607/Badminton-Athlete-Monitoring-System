import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { coachDashboard } from "@/lib/coach-data";
import { CoachTable } from "../table";

/** Athlete roster — search, filters and sorting over the shared CoachTable. */
export default async function CoachAthletesPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const { rows, groups } = await coachDashboard(supabase, profile.timezone);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.nav.athletes}</h1>
      <CoachTable
        rows={rows}
        groups={groups}
        dict={dict}
        locale={profile.preferred_language}
      />
    </div>
  );
}
