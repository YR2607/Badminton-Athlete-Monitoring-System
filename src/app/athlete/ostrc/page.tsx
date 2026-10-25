import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { isFlagEnabled } from "@/lib/flags";
import { isoWeekMonday } from "@/lib/ostrc";
import { todayInTz } from "@/lib/dates";
import { OstrcWizard } from "./wizard";
import { OstrcHeatmap } from "@/components/ostrc-heatmap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OstrcResponse, OstrcZone } from "@/lib/types";

export default async function OstrcPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null);
  const groupIds = (memberships ?? []).map((m) => m.group_id);
  if (!(await isFlagEnabled("ostrc", groupIds))) redirect("/athlete");

  const [{ data: consent }, { data: zones }, { data: history }] = await Promise.all([
    supabase
      .from("consent_records")
      .select("status")
      .eq("athlete_id", athlete.id)
      .eq("consent_type", "parental_data_processing")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("ostrc_zones").select("*").eq("active", true).order("sort_order"),
    supabase
      .from("ostrc_responses")
      .select("*")
      .eq("athlete_id", athlete.id)
      .order("week_start_date", { ascending: false })
      .limit(60),
  ]);

  const week = isoWeekMonday(todayInTz(profile.timezone));
  const historyRows = (history as OstrcResponse[] | null) ?? [];
  const thisWeek = historyRows.filter((r) => r.week_start_date === week);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.ostrc.title}</h1>
      {consent?.status !== "granted" ? (
        <Card>
          <CardContent className="pt-4 text-sm text-muted">{dict.ostrc.consentRequired}</CardContent>
        </Card>
      ) : (
        <OstrcWizard
          dict={{ ostrc: dict.ostrc, common: { error: dict.common.error } }}
          lang={profile.preferred_language}
          zones={(zones as OstrcZone[] | null) ?? []}
          week={week}
          done={thisWeek.length > 0}
        />
      )}
      {historyRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.ostrc.historyTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <OstrcHeatmap
              dict={dict}
              lang={profile.preferred_language}
              zones={(zones as OstrcZone[] | null) ?? []}
              responses={historyRows}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
