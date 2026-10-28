import { redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { todayInTz } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import { MorningForm } from "@/components/forms/morning-form";
import { Card, CardContent } from "@/components/ui/card";
import type { MorningCheckin } from "@/lib/types";

export default async function MorningPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const { data: existing } = await supabase
    .from("morning_checkins")
    .select("*")
    .eq("athlete_id", athlete.id)
    .eq("checkin_date", today)
    .maybeSingle();

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();
  const zscoreOn = await isFlagEnabled(
    "zscore_baseline",
    membership?.group_id ? [membership.group_id] : [],
  );

  // Prefill sleep_hours with the athlete's own recent average (rounded to 0.5h)
  // so morning check-in takes one less tap when sleep duration is steady.
  let defaultSleepHours: number | undefined;
  if (zscoreOn && !existing) {
    const { data: recentSleep } = await supabase
      .from("morning_checkins")
      .select("sleep_hours")
      .eq("athlete_id", athlete.id)
      .not("sleep_hours", "is", null)
      .order("checkin_date", { ascending: false })
      .limit(14);
    const hrs = ((recentSleep as { sleep_hours: number | null }[] | null) ?? [])
      .map((r) => r.sleep_hours)
      .filter((v): v is number => typeof v === "number" && v > 0);
    if (hrs.length >= 2) {
      const mean = hrs.reduce((a, b) => a + b, 0) / hrs.length;
      defaultSleepHours = Math.round(mean * 2) / 2;
    }
  }

  // Only the slices the client form uses — keeps the RSC payload small.
  const formDict = {
    morning: dict.morning,
    common: dict.common,
    athleteHome: { painNotice: dict.athleteHome.painNotice },
    pro: {
      bodyMapTitle: dict.pro.bodyMapTitle,
      bodyZones: dict.pro.bodyZones,
    },
  };

  const ex = existing as MorningCheckin | null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold">{dict.morning.title}</h1>
      <p className="mb-4 text-sm text-muted">{dict.morning.subtitle}</p>
      {ex ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-medium text-ok">✓ {dict.morning.alreadyFilled}</p>
            <p className="text-xs text-muted">{dict.morning.locked}</p>
            <div className="rounded-lg bg-foreground/[0.03] p-3 text-sm">
              <p className="mb-1.5 text-xs font-semibold text-muted">{dict.morning.yourAnswers}</p>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted">
                <li>{dict.history.sleep}: <b className="text-foreground">{ex.sleep_score}</b>{ex.sleep_hours != null ? ` (${ex.sleep_hours}h)` : ""}</li>
                <li>{dict.history.recovery}: <b className="text-foreground">{ex.recovery_score}</b></li>
                <li>{dict.history.fatigue}: <b className="text-foreground">{ex.fatigue_score}</b></li>
                <li>{dict.history.soreness}: <b className="text-foreground">{ex.muscle_soreness_score}</b></li>
                <li>{dict.history.stress}: <b className="text-foreground">{ex.stress_score}</b></li>
                <li>{dict.history.mood}: <b className="text-foreground">{ex.mood_score}</b></li>
              </ul>
              {ex.pain_status !== "none" && (
                <p className="mt-1.5 text-warn">
                  {dict.day.pain}: {ex.pain_location ?? ex.pain_status}
                  {ex.pain_severity != null ? ` (${ex.pain_severity}/10)` : ""}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <MorningForm
          dict={formDict}
          checkinDate={today}
          showSleepHours={zscoreOn}
          defaultSleepHours={defaultSleepHours}
        />
      )}
    </div>
  );
}
