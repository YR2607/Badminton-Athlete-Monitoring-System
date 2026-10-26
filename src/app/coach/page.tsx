import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { coachDashboard } from "@/lib/coach-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupBodyHeatmap, type GroupPainEntry } from "@/components/forms/body-map";
import { addDays, todayInTz } from "@/lib/dates";
import { ageInDays } from "@/lib/athlete-status";
import { CoachTable } from "./table";
import { CompareChart, type CompareAthlete } from "./compare";
import { LoadReadinessQuadrant, type QuadrantPoint } from "./quadrant";
import { GroupSessionForm } from "./group-session-form";

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
  const coachToday = todayInTz(profile.timezone);

  // Dashboard rows, feature flags and upcoming tournaments in one batch.
  const { getFeatureFlags, flagEnabled } = await import("@/lib/flags");
  const [{ rows, groups }, flags, { data: upcomingTournaments }] = await Promise.all([
    coachDashboard(supabase, profile.timezone),
    getFeatureFlags(),
    supabase
      .from("calendar_events")
      .select("*")
      .eq("kind", "tournament")
      .gte("end_date", coachToday)
      .lte("start_date", addDays(coachToday, 14))
      .order("start_date", { ascending: true })
      .limit(3),
  ]);
  const ostrcOn = flagEnabled(flags, "ostrc", null);
  const eventsOn = flagEnabled(flags, "events", null);
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

  // Feature 1 — Pre-session briefing buckets.
  const nameOf = (r: (typeof rows)[number]) => r.profile?.display_name ?? r.athlete.athlete_code;
  const briefCheck = sorted.filter(
    (r) =>
      r.status === "needs_check" ||
      r.acuteSignal ||
      (r.todayCheckin && r.todayCheckin.pain_status !== "none") ||
      (r.todayScore !== null && r.todayScore < 55),
  );
  const checkIds = new Set(briefCheck.map((r) => r.athlete.id));
  const briefReduce = sorted.filter(
    (r) =>
      !checkIds.has(r.athlete.id) &&
      (r.status === "declining" ||
        (r.readinessDelta !== null && r.readinessDelta <= -8) ||
        (r.todayScore !== null && r.todayScore < 68)),
  );
  const reduceIds = new Set(briefReduce.map((r) => r.athlete.id));
  const briefAsk = sorted.filter((r) => !r.todayCheckin && !checkIds.has(r.athlete.id));
  const briefReady = sorted.filter(
    (r) => r.todayCheckin && !checkIds.has(r.athlete.id) && !reduceIds.has(r.athlete.id),
  );

  // Feature 2 — 2D Load × Readiness points (athletes with a known score).
  const quadrantPoints: QuadrantPoint[] = sorted
    .filter((r) => (r.todayScore ?? r.lastKnownScore) !== null)
    .map((r) => ({
      id: r.athlete.id,
      name: nameOf(r),
      load: r.weeklyLoadAu,
      readiness: (r.todayScore ?? r.lastKnownScore)!,
      hasPain: r.hasPain,
      isToday: r.todayScore !== null,
    }));

  // Group pain map entries (last 7 days).
  const groupPainEntries: GroupPainEntry[] = sorted.flatMap((r) =>
    r.recentPainEntries.map((pe) => ({
      athleteId: r.athlete.id,
      athleteName: nameOf(r),
      date: pe.date,
      location: pe.location,
      side: pe.side,
      severity: pe.severity,
      dominantHit: pe.dominantHit,
    })),
  );

  // Tapering countdown for the nearest tournament within 14 days.
  const nextTournament = ((upcomingTournaments as import("@/lib/types").CalendarEvent[] | null) ?? [])[0] ?? null;
  const taperDaysLeft = nextTournament ? Math.max(0, ageInDays(coachToday, nextTournament.start_date)) : null;
  const avgLoad7 = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.weeklyLoadAu, 0) / rows.length)
    : 0;
  const avgLoadPrev7 = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.prevWeeklyLoadAu, 0) / rows.length)
    : 0;
  const taperRatio = avgLoadPrev7 > 0 ? Math.round((avgLoad7 / avgLoadPrev7) * 100) / 100 : null;

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

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{d.briefingTitle}</CardTitle>
                <p className="text-xs text-muted">{d.briefingHint}</p>
              </div>
              <div className="flex gap-2">
                <Link href="/coach/attendance">
                  <Button size="sm" variant="secondary">
                    ✅ {dict.nav.attendance}
                  </Button>
                </Link>
                {briefAsk.length > 0 && (
                  <Link href="/coach/kiosk">
                    <Button size="sm">
                      📋 {dict.pro.kioskBtn} ({briefAsk.length})
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs font-semibold text-danger">
                  🔴 {d.briefingCheck} ({briefCheck.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefCheck.length === 0 ? (
                    <span className="text-xs text-muted">{d.briefingNone}</span>
                  ) : (
                    briefCheck.map((r) => (
                      <Link
                        key={r.athlete.id}
                        href={`/coach/athletes/${r.athlete.id}`}
                        className="rounded-lg border border-danger/40 bg-surface px-2 py-1 text-xs font-medium hover:bg-danger/10"
                      >
                        {nameOf(r)}
                        {r.todayScore !== null ? ` · ${Math.round(r.todayScore)}` : ""}
                        {r.todayCheckin?.pain_location ? ` · ${r.todayCheckin.pain_location}` : ""}
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-xs font-semibold text-warn">
                  🟡 {d.briefingReduce} ({briefReduce.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefReduce.length === 0 ? (
                    <span className="text-xs text-muted">{d.briefingNone}</span>
                  ) : (
                    briefReduce.map((r) => (
                      <Link
                        key={r.athlete.id}
                        href={`/coach/athletes/${r.athlete.id}`}
                        className="rounded-lg border border-warn/40 bg-surface px-2 py-1 text-xs font-medium hover:bg-warn/10"
                      >
                        {nameOf(r)}
                        {r.todayScore !== null ? ` · ${Math.round(r.todayScore)}` : ""}
                        {r.readinessDelta !== null ? ` (${r.readinessDelta > 0 ? `+${r.readinessDelta}` : r.readinessDelta})` : ""}
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-foreground/[0.02] p-3">
                <p className="text-xs font-semibold text-muted">
                  ⚪ {d.briefingAsk} ({briefAsk.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefAsk.length === 0 ? (
                    <span className="text-xs text-muted">{d.briefingNone}</span>
                  ) : (
                    briefAsk.map((r) => (
                      <Link
                        key={r.athlete.id}
                        href={`/coach/athletes/${r.athlete.id}`}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-foreground/5"
                      >
                        {nameOf(r)}
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-ok/30 bg-ok/5 p-3">
                <p className="text-xs font-semibold text-ok">
                  🟢 {d.briefingReady} ({briefReady.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefReady.length === 0 ? (
                    <span className="text-xs text-muted">{d.briefingNone}</span>
                  ) : (
                    briefReady.map((r) => (
                      <Link
                        key={r.athlete.id}
                        href={`/coach/athletes/${r.athlete.id}`}
                        className="rounded-lg border border-ok/30 bg-surface px-2 py-1 text-xs font-medium hover:bg-ok/10"
                      >
                        {nameOf(r)}
                        {r.todayScore !== null ? ` · ${Math.round(r.todayScore)}` : ""}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {nextTournament && taperDaysLeft !== null && (
        <Card className="border-accent/40 bg-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>
                🏆{" "}
                {taperDaysLeft === 0
                  ? dict.pro.taperToday.replace("{name}", nextTournament.title)
                  : dict.pro.taperDaysLeft
                      .replace("{name}", nextTournament.title)
                      .replace("{d}", String(taperDaysLeft))}
              </span>
              <Badge tone={taperDaysLeft <= 7 ? "warn" : "accent"}>
                {taperDaysLeft <= 7 ? dict.pro.taperPhaseTaper : dict.pro.taperPhaseLoad}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>
              {dict.pro.taperGroupLoad}: <b className="text-foreground">{avgLoad7} AU</b> vs{" "}
              <b className="text-foreground">{avgLoadPrev7} AU</b>
              {taperRatio !== null ? ` (${Math.round(taperRatio * 100)}%)` : ""}
            </span>
            {taperDaysLeft <= 7 && taperRatio !== null && (
              <Badge tone={taperRatio <= 0.85 ? "ok" : "warn"}>
                {taperRatio <= 0.85 ? dict.pro.taperFreshOk : dict.pro.taperOverloadWarn}
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {groupPainEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.pro.bodyMapGroupTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <GroupBodyHeatmap entries={groupPainEntries} dict={dict} />
          </CardContent>
        </Card>
      )}

      {quadrantPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{d.quadrantTitle}</CardTitle>
            <p className="text-xs text-muted">{d.quadrantHint}</p>
          </CardHeader>
          <CardContent>
            <LoadReadinessQuadrant points={quadrantPoints} dict={dict} />
          </CardContent>
        </Card>
      )}

      <GroupSessionForm groups={groups} dict={dict} />

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
