import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { coachDashboard } from "@/lib/coach-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CoachTable } from "./table";
import { CompareChart, type CompareAthlete } from "./compare";

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
  const { rows, groups } = await coachDashboard(supabase, profile.timezone);

  // Phase 3: weekly OSTRC prevalence per zone (flag 'ostrc').
  const { isFlagEnabled } = await import("@/lib/flags");
  const ostrcOn = await isFlagEnabled("ostrc", null);
  type ORow = { athlete_id: string; zone_code: string; week_start_date: string; any_problem: boolean; substantial: boolean };
  let ostrcPrev: { zone: string; name: string; anyPct: number; subPct: number; n: number }[] = [];
  if (ostrcOn) {
    const ids = rows.map((r) => r.athlete.id);
    const [{ data: zRows }, { data: oRows }] = await Promise.all([
      supabase.from("ostrc_zones").select("*").eq("active", true).order("sort_order"),
      ids.length
        ? supabase
            .from("ostrc_responses")
            .select("athlete_id, zone_code, week_start_date, any_problem, substantial")
            .in("athlete_id", ids)
            .order("week_start_date", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]);
    const all = (oRows as ORow[] | null) ?? [];
    const latestWeek = all[0]?.week_start_date ?? null;
    if (latestWeek) {
      const wk = all.filter((r) => r.week_start_date === latestWeek);
      ostrcPrev = (((zRows as import("@/lib/types").OstrcZone[] | null) ?? []).map((z) => {
        const zr = wk.filter((r) => r.zone_code === z.code);
        const n = zr.length;
        return {
          zone: z.code,
          name: z.name[profile.preferred_language as "ru" | "en" | "ro"] || z.name.en || z.code,
          n,
          anyPct: n ? Math.round((zr.filter((r) => r.any_problem).length / n) * 100) : 0,
          subPct: n ? Math.round((zr.filter((r) => r.substantial).length / n) * 100) : 0,
        };
      })).filter((z) => z.n > 0);
    }
  }

  const filled = rows.filter((r) => r.todayCheckin).length;
  const openAlerts = rows.flatMap((r) => r.openAlerts);
  const priority = rows.filter((r) => r.status === "needs_check").length;
  const declining = rows.filter((r) => r.status === "declining").length;
  const pendingPosts = rows.filter((r) => r.pendingPostCount > 0).length;

  const sorted = [...rows].sort((a, b) =>
    (a.profile?.display_name ?? a.athlete.athlete_code).localeCompare(
      b.profile?.display_name ?? b.athlete.athlete_code,
    ),
  );
  const compareAthletes: CompareAthlete[] = sorted.map((r, i) => ({
    id: r.athlete.id,
    name: r.profile?.display_name ?? r.athlete.athlete_code,
    flagged:
      r.hasPain ||
      r.openAlerts.length > 0 ||
      (!rows.some((x) => x.hasPain || x.openAlerts.length > 0) && i < 3),
    series: r.series,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{d.dashboard}</h1>
        <p className="text-sm text-muted">{d.dashboardHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            <p className="text-xs text-muted">{d.sumNoToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-danger">{priority}</p>
            <p className="text-xs text-muted">
              {d.sumPriority} · {d.openAlerts}: {openAlerts.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-warn">{declining}</p>
            <p className="text-xs text-muted">{d.sumDeclining}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{pendingPosts}</p>
            <p className="text-xs text-muted">{d.sumPendingPost}</p>
          </CardContent>
        </Card>
      </div>

      {ostrcPrev.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.ostrc.prevTitle}</CardTitle>
            <p className="text-xs text-muted">{dict.ostrc.prevHint}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {ostrcPrev.map((z) => (
                <div key={z.zone} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                  <p className="font-medium">{z.name}</p>
                  <p className="text-xs text-muted">
                    {dict.ostrc.anyProblem}: <b className={z.anyPct ? "text-warn" : ""}>{z.anyPct}%</b>
                    {" · "}
                    {dict.ostrc.substantialCap}:{" "}
                    <b className={z.subPct ? "text-danger" : ""}>{z.subPct}%</b>
                    {" · "}n={z.n}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{d.compare}</CardTitle>
          <p className="text-xs text-muted">{d.compareHint}</p>
        </CardHeader>
        <CardContent>
          <CompareChart athletes={compareAthletes} dict={dict} />
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
