import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { coachDashboard } from "@/lib/coach-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CoachTable } from "./table";
import { GroupTrendChart } from "./trend-chart";

export default async function CoachDashboard({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; alerts?: string }>;
}) {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const d = dict.coach;
  const supabase = await createClient();
  void (await searchParams);
  const { rows, groups } = await coachDashboard(supabase, profile.id, profile.timezone);

  const filled = rows.filter((r) => r.todayCheckin).length;
  const openAlerts = rows.flatMap((r) => r.openAlerts);
  const priority = openAlerts.filter((a) => a.severity === "priority").length;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{d.dashboard}</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{rows.length}</p>
            <p className="text-xs text-muted">{d.athletesInGroup}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-ok">{filled}</p>
            <p className="text-xs text-muted">{d.filledToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-warn">{rows.length - filled}</p>
            <p className="text-xs text-muted">{d.missingToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-danger">{priority}</p>
            <p className="text-xs text-muted">
              {d.priorityAlerts} · {d.openAlerts}: {openAlerts.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{d.groupWeek}</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupTrendChart coachProfileId={profile.id} tz={profile.timezone} />
        </CardContent>
      </Card>

      <CoachTable rows={rows} groups={groups} dict={dict} />

      <p className="text-xs text-muted">
        <Link href="/coach/alerts" className="underline">
          {dict.nav.alerts}
        </Link>
      </p>
    </div>
  );
}

export function SeverityBadge({ severity, dict }: { severity: string; dict: ReturnType<typeof getDictionary> }) {
  const tone =
    severity === "priority" ? "danger" : severity === "review_load" ? "warn" : severity === "attention" ? "accent" : "neutral";
  return <Badge tone={tone}>{dict.alerts.severity[severity as keyof typeof dict.alerts.severity] ?? severity}</Badge>;
}
