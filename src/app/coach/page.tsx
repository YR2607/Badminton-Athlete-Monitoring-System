import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { coachDashboard } from "@/lib/coach-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupBodyHeatmap, type GroupPainEntry } from "@/components/forms/body-map";
import { LoadBarChart } from "@/components/charts/series-chart";
import { addDays, dateRange, localDate, todayInTz } from "@/lib/dates";
import { analyzeLoadWave } from "@/lib/load";
import type { TrainingSession } from "@/lib/types";
import { ageInDays } from "@/lib/athlete-status";
import { CoachTable } from "./table";

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
  const eventsOn = flagEnabled(flags, "events", null);

  // Day-overview strip: today's attendance marks, this week's OSTRC survey,
  // today's Academy lesson — each tile deep-links into its section.
  const admin = createAdminClient();
  const athleteIds = rows.map((r) => r.athlete.id);
  const { isoWeekMonday } = await import("@/lib/ostrc");
  const [{ data: attRows }, { data: ostrcRows }, { data: acadRows }] =
    athleteIds.length
      ? await Promise.all([
          admin
            .from("attendance")
            .select("athlete_id")
            .eq("att_date", coachToday)
            .in("athlete_id", athleteIds),
          admin
            .from("ostrc_responses")
            .select("athlete_id")
            .eq("week_start_date", isoWeekMonday(coachToday))
            .in("athlete_id", athleteIds),
          admin
            .from("academy_responses")
            .select("athlete_id")
            .eq("assigned_date", coachToday)
            .in("athlete_id", athleteIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
  const attMarked = new Set(((attRows ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)).size;
  const ostrcFilled = new Set(((ostrcRows ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)).size;
  const acadDone = new Set(((acadRows ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)).size;

  // 14-day BWF load wave (mean active AU per day across the group).
  const { data: waveSessionsRaw } = athleteIds.length
    ? await supabase
        .from("training_sessions")
        .select("athlete_id, session_rpe, duration_minutes, started_at")
        .in("athlete_id", athleteIds)
        .gte("started_at", `${addDays(coachToday, -13)}T00:00:00Z`)
        .lt("started_at", `${addDays(coachToday, 1)}T00:00:00Z`)
    : { data: [] };
  const tzOf = (athleteId: string) =>
    rows.find((r) => r.athlete.id === athleteId)?.profile?.timezone ??
    profile.timezone;
  const wave14Days = dateRange(addDays(coachToday, -13), coachToday).map((dt) => {
    const dayTotals = new Map<string, number>();
    for (const s of (waveSessionsRaw ?? []) as TrainingSession[]) {
      if (s.session_rpe == null || s.duration_minutes == null) continue;
      const sd = localDate(new Date(s.started_at), tzOf(s.athlete_id));
      if (sd !== dt) continue;
      dayTotals.set(
        s.athlete_id,
        (dayTotals.get(s.athlete_id) ?? 0) + s.session_rpe * s.duration_minutes,
      );
    }
    const vals = [...dayTotals.values()];
    const avg = vals.length
      ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length)
      : 0;
    return { date: dt, load: avg };
  });
  const wave14 = analyzeLoadWave(wave14Days);

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
  const nextTournament = eventsOn
    ? (((upcomingTournaments as import("@/lib/types").CalendarEvent[] | null) ?? [])[0] ?? null)
    : null;
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
        <Card title={d.statTipTotal}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{rows.length}</p>
            <p className="text-xs text-muted">{d.athletesInGroup}</p>
          </CardContent>
        </Card>
        <Card title={d.statTipFilled}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-ok">{filled}</p>
            <p className="text-xs text-muted">{d.filledToday}</p>
          </CardContent>
        </Card>
        <Card title={d.statTipNoToday}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-warn">{rows.length - filled}</p>
            <p className="text-xs text-muted">{d.sumNoToday}</p>
          </CardContent>
        </Card>
        <Card title={d.statTipPriority}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-danger">{priority}</p>
            <p className="text-xs text-muted">
              {d.sumPriority} · {d.openAlerts}: {openAlerts.length}
            </p>
          </CardContent>
        </Card>
        <Card title={d.statTipDeclining}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-warn">{declining}</p>
            <p className="text-xs text-muted">{d.sumDeclining}</p>
          </CardContent>
        </Card>
        <Card title={d.statTipPendingPost}>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{pendingPosts}</p>
            <p className="text-xs text-muted">{d.sumPendingPost}</p>
          </CardContent>
        </Card>
      </div>

      {/* Day overview — one-glance links into the auxiliary sections. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            href: "/coach/attendance",
            value: `${attMarked}/${rows.length}`,
            label: dict.nav.attendance,
            sub: d.quickAttSub,
          },
          {
            href: "/analytics",
            value: `${ostrcFilled}/${rows.length}`,
            label: dict.ostrc.title,
            sub: d.quickOstrcSub,
          },
          {
            href: "/coach/academy",
            value: `${acadDone}/${rows.length}`,
            label: dict.nav.academy,
            sub: d.quickAcadSub,
          },
          {
            href: "/coach/alerts",
            value: String(openAlerts.length),
            label: dict.nav.alerts,
            sub: d.quickAlertsSub,
          },
        ].map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="h-full transition-colors hover:border-accent/50">
              <CardContent className="pt-4">
                <p className="text-2xl font-bold tabular-nums">{t.value}</p>
                <p className="text-xs font-medium">{t.label} →</p>
                <p className="text-[11px] text-muted">{t.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 14-day BWF load wave (peaks 🔴 & deloads 🟢) */}
      {wave14Days.some((day) => day.load > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{dict.dashboard.waveTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <LoadBarChart
              data={wave14Days.map((x) => ({
                date: x.date.slice(5),
                load: x.load,
                wave: wave14.tags.get(x.date) ?? null,
              }))}
              label={dict.dashboard.fact}
            />
            <p className="text-[11px] text-muted">{dict.dashboard.waveLegend}</p>
            {wave14.status !== "insufficient" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span
                  className={
                    wave14.status === "monotonous" ? "text-warn" : "text-ok"
                  }
                >
                  {wave14.status === "monotonous"
                    ? `⚠️ ${dict.dashboard.waveMonotonous}`
                    : `✅ ${dict.dashboard.waveGood}`}
                </span>
                <span className="text-muted">
                  {dict.dashboard.wavePeaks.replace("{p}", String(wave14.peaks))} ·{" "}
                  {dict.dashboard.waveRecoveries.replace("{r}", String(wave14.recoveries))} ·{" "}
                  {dict.dashboard.waveAvg.replace("{m}", String(wave14.meanActive))}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <Button size="sm" variant="secondary" title={dict.pro.attendanceBtnHint}>
                    ✅ {dict.nav.attendance}
                  </Button>
                </Link>
                {briefAsk.length > 0 && (
                  <Link href="/coach/kiosk">
                    <Button size="sm" title={dict.pro.kioskBtnHint}>
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
                <p className="text-xs font-semibold text-danger" title={d.bucketTipCheck}>
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
                <p className="text-xs font-semibold text-warn" title={d.bucketTipReduce}>
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
                <p className="text-xs font-semibold text-muted" title={d.bucketTipAsk}>
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
                <p className="text-xs font-semibold text-ok" title={d.bucketTipReady}>
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
              <Badge tone={taperDaysLeft <= 7 ? "warn" : "accent"} title={dict.pro.taperPhaseHint}>
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
              <Badge
                tone={taperRatio <= 0.85 ? "ok" : "warn"}
                title={dict.pro.taperRatioHint}
              >
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

      <CoachTable rows={rows} groups={groups} dict={dict} />

      <p className="text-xs text-muted">
        <Link href="/coach/alerts" className="underline">
          {dict.nav.alerts}
        </Link>
      </p>
    </div>
  );
}


