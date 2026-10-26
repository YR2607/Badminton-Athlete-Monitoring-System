import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { coachDashboard } from "@/lib/coach-data";
import { KioskClient, type KioskAthlete } from "./kiosk-client";

export default async function CoachKioskPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const { rows } = await coachDashboard(supabase, profile.timezone);

  const missing: KioskAthlete[] = rows
    .filter((r) => !r.todayCheckin)
    .map((r) => ({
      id: r.athlete.id,
      name: r.profile?.display_name ?? r.athlete.athlete_code,
      code: r.athlete.athlete_code,
      groupName: r.group?.name ?? "—",
      today: r.today,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <Link href="/coach" className="text-sm text-accent">
          ← {dict.coach.dashboard}
        </Link>
        <h1 className="mt-1 text-xl font-bold">{dict.pro.kioskTitle}</h1>
        <p className="text-sm text-muted">{dict.pro.kioskSubtitle}</p>
      </div>
      <KioskClient athletes={missing} dict={dict} />
    </div>
  );
}
