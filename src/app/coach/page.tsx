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
import { LoadBarChart, SeriesLineChart } from "@/components/charts/series-chart";
import { KPIStat } from "@/components/ui/kpi-stat";
import { AthleteAvatar } from "@/components/ui/athlete-avatar";
import { DataCoverageIndicator } from "@/components/ui/states";
import { avatarPublicUrl } from "@/lib/avatars";
import { addDays, dateRange, localDate, todayInTz } from "@/lib/dates";
import { analyzeLoadWave, plannedForDate, weekdayOf, type PlanOverride, type ScheduleInput } from "@/lib/load";
import type { TrainingSession } from "@/lib/types";
import { ageInDays } from "@/lib/athlete-status";
import { AlertList } from "@/app/coach/athletes/[id]/alert-list";
import { AIInsightCard } from "@/components/ai/insight-card";
import { getLatestGroupInsight, type InsightRow } from "@/app/actions/ai-insights";
import { ChevronDown } from "lucide-react";

export default async function CoachDashboard({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; alerts?: string }>;
}) {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const d = dict.coach;
  const supabase = await createClient();
  const sp = await searchParams;
  const coachToday = todayInTz(profile.timezone);

  // Dashboard rows, feature flags and upcoming tournaments in one batch.
  const { getFeatureFlags, flagEnabled } = await import("@/lib/flags");
  const [{ rows: allRows, groups }, flags, { data: upcomingTournaments }] = await Promise.all([
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
  const groupFilter = sp.group ?? "";
  const rows = groupFilter
    ? allRows.filter((r) => r.group?.id === groupFilter)
    : allRows;
  const aiOn = flagEnabled(flags, "ai", null);
  const briefGroupId = groupFilter || groups[0]?.id || "";
  let groupInsight: InsightRow | null = null;
  if (aiOn && briefGroupId) {
    const r = await getLatestGroupInsight(briefGroupId);
    if (r.ok) groupInsight = r.data;
  }

  // Day-overview strip: today's attendance marks, this week's OSTRC survey,
  // today's Academy lesson — each tile deep-links into its section.
  const admin = createAdminClient();
  const athleteIds = rows.map((r) => r.athlete.id);
  const { data: attRows } = athleteIds.length
    ? await admin
        .from("attendance")
        .select("athlete_id")
        .eq("att_date", coachToday)
        .in("athlete_id", athleteIds)
    : { data: [] };
  const attMarked = new Set(((attRows ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)).size;

  // Is any of the coach's groups scheduled to train today (template or override)?
  const groupIds = groups.map((g) => g.id);
  const waveFrom = addDays(coachToday, -13);
  const [{ data: schedRows }, { data: overrideRows }] = groupIds.length
    ? await Promise.all([
        supabase
          .from("training_schedules")
          .select("weekday, planned_minutes, planned_rpe, start_time, group_id")
          .in("group_id", groupIds)
          .eq("active", true),
        supabase
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe, group_id")
          .in("group_id", groupIds)
          .gte("plan_date", waveFrom)
          .lte("plan_date", coachToday),
      ])
    : [{ data: [] }, { data: [] }];
  const plannedToday = groups.some((g) =>
    plannedForDate(
      coachToday,
      ((schedRows ?? []) as (ScheduleInput & { group_id: string })[]).filter(
        (s) => s.group_id === g.id,
      ),
      ((overrideRows ?? []) as (PlanOverride & { group_id: string })[]).filter(
        (o) => o.group_id === g.id && o.plan_date === coachToday,
      ),
    ).scheduled,
  );

  // 14-day BWF load wave (mean active AU per day across the group).
  const { data: waveSessionsRaw } = athleteIds.length
    ? await supabase
        .from("training_sessions")
        .select("athlete_id, session_rpe, duration_minutes, started_at")
        .in("athlete_id", athleteIds)
        .gte("started_at", `${addDays(coachToday, -13)}T00:00:00Z`)
        .lt("started_at", `${addDays(coachToday, 1)}T00:00:00Z`)
    : { data: [] };
  const { data: memberRows } = athleteIds.length
    ? await supabase
        .from("group_memberships")
        .select("athlete_id, group_id")
        .in("athlete_id", athleteIds)
        .is("left_at", null)
    : { data: [] };
  const groupOf = new Map(
    athleteIds.map((id) => [
      id,
      ((memberRows ?? []) as { athlete_id: string; group_id: string }[]).find(
        (m) => m.athlete_id === id,
      )?.group_id ?? null,
    ]),
  );
  const schedAll = (schedRows ?? []) as (ScheduleInput & { group_id: string; start_time?: string | null })[];
  const ovAll = (overrideRows ?? []) as (PlanOverride & { group_id: string; start_time?: string | null })[];
  // Today's scheduled sessions per group — time, planned duration and RPE.
  const todayTrainings = groups
    .map((g) => {
      const plan = plannedForDate(
        coachToday,
        schedAll.filter((s) => s.group_id === g.id),
        ovAll.filter((o) => o.group_id === g.id),
      );
      const ov = ovAll.find((o) => o.group_id === g.id && o.plan_date === coachToday);
      const schedRow = schedAll.find(
        (s) => s.group_id === g.id && s.weekday === weekdayOf(coachToday),
      );
      return { group: g, plan, time: ov?.start_time ?? schedRow?.start_time ?? null };
    })
    .filter((t) => t.plan.scheduled);
  const tzOf = (athleteId: string) =>
    rows.find((r) => r.athlete.id === athleteId)?.profile?.timezone ??
    profile.timezone;
  const wave14Days = dateRange(waveFrom, coachToday).map((dt) => {
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
    // Coach's plan for the day — mean planned AU over athletes whose
    // group has a plan, so the wave shows "задано vs получилось".
    let planSum = 0;
    let planN = 0;
    for (const id of athleteIds) {
      const g = groupOf.get(id);
      if (!g) continue;
      const p = plannedForDate(
        dt,
        schedAll.filter((s) => s.group_id === g),
        ovAll.filter((o) => o.group_id === g),
      ).planned;
      if (p != null) {
        planSum += p;
        planN++;
      }
    }
    return {
      date: dt,
      load: avg,
      n: vals.length,
      planned: planN ? Math.round(planSum / planN) : null,
    };
  });
  const wave14 = analyzeLoadWave(wave14Days);
  // Sample size behind the group average — an avg over 3 of 20 athletes
  // must not read as "the group".
  const waveAthletes = rows.length;
  const waveCoveragePct =
    waveAthletes > 0
      ? Math.round(
          (wave14Days.reduce((a, d) => a + d.n, 0) / (waveAthletes * wave14Days.length)) * 100,
        )
      : 0;
  const waveMaxN = Math.max(0, ...wave14Days.map((d) => d.n));

  const filled = rows.filter((r) => r.todayCheckin).length;
  const openAlerts = rows.flatMap((r) => r.openAlerts);
  const priorityAlerts = openAlerts.filter((a) => a.severity === "priority");
  const alertOptions = rows
    .map((r) => ({
      id: r.athlete.id,
      name: r.profile?.display_name ?? r.athlete.athlete_code,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const sorted = [...rows].sort((a, b) =>
    (a.profile?.display_name ?? a.athlete.athlete_code).localeCompare(
      b.profile?.display_name ?? b.athlete.athlete_code,
    ),
  );

  // Feature 1 — Pre-session priority list: every athlete lands in exactly
  // one mutually-exclusive category (classifyAthlete in coach-data).
  const nameOf = (r: (typeof rows)[number]) => r.profile?.display_name ?? r.athlete.athlete_code;
  const briefCheck = sorted.filter((r) => r.priority.category === "check");
  const briefReduce = sorted.filter((r) => r.priority.category === "review");
  const briefAsk = sorted.filter((r) => r.priority.category === "missing");
  const briefReady = sorted.filter((r) => r.priority.category === "none");

  // ── KPI strip (spec §4.1): attention · morning readiness · today load ·
  // questionnaire completion. Missing data stays visibly missing, never 0.
  const attentionCount = briefCheck.length + briefReduce.length;
  const scoredToday = rows.filter((r) => r.todayScore !== null);
  const avgReadiness = scoredToday.length
    ? Math.round(scoredToday.reduce((a, r) => a + (r.todayScore ?? 0), 0) / scoredToday.length)
    : null;
  const completionPct = rows.length ? Math.round((filled / rows.length) * 100) : 0;
  const todayWave = wave14Days.at(-1);

  // Secondary analytics: 7-day group readiness trend — mean morning score
  // over athletes who reported that day; gaps stay gaps (connectNulls off).
  const readinessTrend = dateRange(addDays(coachToday, -6), coachToday).map((dt) => {
    const vals = rows
      .map((r) => r.series.find((p) => p.date === dt)?.score)
      .filter((v): v is number => v != null);
    return {
      date: dt.slice(5),
      score: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    };
  });

  const reasonText = (r: (typeof rows)[number]): string => {
    switch (r.priority.reason) {
      case "acute_flags": return d.reasonAcute;
      case "priority_alert": return d.reasonPriorityAlert;
      case "decline_alert": return d.reasonDecline;
      case "below_norm": return d.reasonBelowNorm;
      case "pain_reported": return d.reasonPain;
      case "no_checkin_today": return d.reasonNoCheckin;
      case "stale_checkin": return r.lastCheckinAgeDays !== null
        ? `${d.reasonStale} · ${r.lastCheckinAgeDays} ${d.daysAgo}`
        : d.reasonStale;
      case "pending_post": return d.reasonPendingPost;
      case "norm_not_formed": return d.reasonNoNorm;
      case "missed_session": return d.reasonMissed;
      default: return "";
    }
  };
  const actionText = (r: (typeof rows)[number]): string => {
    switch (r.priority.reason) {
      case "acute_flags":
      case "priority_alert": return d.actionCheck;
      case "decline_alert":
      case "below_norm":
      case "pain_reported": return d.actionAsk;
      case "no_checkin_today":
      case "stale_checkin": return d.actionFill;
      case "pending_post": return d.actionRemind;
      case "norm_not_formed": return d.actionWait;
      case "missed_session": return d.actionVerify;
      default: return "";
    }
  };

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

  const avatarOf = (r: (typeof rows)[number]) => (
    <AthleteAvatar
      name={nameOf(r)}
      src={r.athlete.photo_path ? avatarPublicUrl(r.athlete.photo_path) : null}
      size="sm"
    />
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">
            {dict.athleteHome.greeting}, {profile.display_name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted">{coachToday} · {d.dashboardHint}</p>
        </div>
        <Link href="/coach/attendance">
          <Button size="sm" variant="secondary" title={dict.pro.attendanceBtnHint}>
            ✅ {dict.nav.attendance}
          </Button>
        </Link>
      </div>

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Link
            href="/coach"
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              !groupFilter ? "border-accent bg-accent text-white" : "border-border bg-surface"
            }`}
          >
            {d.allGroups}
          </Link>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/coach?group=${g.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                groupFilter === g.id
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface"
              }`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}

      {priorityAlerts.length > 0 && (
        <Card className="border-danger/50 bg-danger/5">
          <CardHeader>
            <CardTitle>
              🚨 {d.priorityAlertsTitle} ({priorityAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AlertList alerts={priorityAlerts} dict={dict} athletes={alertOptions} />
          </CardContent>
        </Card>
      )}

      {plannedToday && attMarked === 0 && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="flex items-center justify-between gap-3 pt-4">
            <p className="text-sm font-medium">✅ {d.attCtaText}</p>
            <Link href="/coach/attendance" className="shrink-0">
              <Button size="sm">{d.attCtaBtn}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* KPI strip — attention, morning readiness, today's load, completion. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/coach/athletes">
          <KPIStat
            tone={attentionCount > 0 ? "danger" : "ok"}
            value={attentionCount}
            label={d.kpiAttention}
            sub={`${briefCheck.length} · ${briefReduce.length}`}
            hint={d.briefingHint}
            className="h-full transition-colors hover:border-accent/40"
          />
        </Link>
        <Link href="/analytics">
          <KPIStat
            tone={avgReadiness === null ? "neutral" : avgReadiness >= 70 ? "ok" : avgReadiness >= 45 ? "warn" : "danger"}
            value={avgReadiness ?? "—"}
            label={d.kpiReadiness}
            sub={d.kpiReadinessSub.replace("{n}", String(scoredToday.length))}
            hint={dict.common.readinessHint}
            className="h-full transition-colors hover:border-accent/40"
          />
        </Link>
        <Link href="/analytics">
          <KPIStat
            value={todayWave && todayWave.load > 0 ? `${todayWave.load} AU` : "—"}
            label={d.kpiLoad}
            sub={
              todayWave?.planned != null
                ? d.kpiLoadPlan.replace("{p}", String(todayWave.planned))
                : todayWave && todayWave.n > 0
                  ? `n=${todayWave.n}`
                  : d.noTrainingToday
            }
            className="h-full transition-colors hover:border-accent/40"
          />
        </Link>
        <Link href="/coach/attendance">
          <div className="h-full rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40">
            <p className="text-2xl font-bold tabular-nums leading-none">
              {filled}/{rows.length}
            </p>
            <p className="text-xs text-muted">{d.kpiCoverage}</p>
            <DataCoverageIndicator pct={completionPct} className="mt-1" />
          </div>
        </Link>
      </div>

      {rows.length > 0 && (
        <Card className="border-0 bg-navy text-white shadow-md">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-white">{d.briefingTitle}</CardTitle>
                <p className="text-xs text-white/60">{d.briefingHint}</p>
              </div>
              <div className="flex gap-2">
                <Link href="/coach/attendance">
                  <Button size="sm" variant="secondary" title={dict.pro.attendanceBtnHint} className="bg-white/10 text-white hover:bg-white/20">
                    ✅ {dict.nav.attendance}
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-danger/40 bg-danger/15 p-3">
                <p className="text-xs font-semibold text-red-300" title={d.bucketTipCheck}>
                  🔴 {d.briefingCheck} ({briefCheck.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefCheck.length === 0 ? (
                    <span className="text-xs text-white/50">{d.briefingNone}</span>
                  ) : (
                    <ul className="w-full space-y-1.5">
                      {briefCheck.map((r) => (
                        <li key={r.athlete.id}>
                          <Link
                            href={`/coach/athletes/${r.athlete.id}`}
                            className="flex items-center gap-2 rounded-lg border border-danger/40 bg-surface px-2 py-1.5 text-xs hover:bg-danger/10"
                          >
                            {avatarOf(r)}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2 font-medium">
                                <span className="truncate">{nameOf(r)}</span>
                                {r.todayScore !== null && (
                                  <span className="tabular-nums text-muted">{Math.round(r.todayScore)}</span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-danger">
                                {reasonText(r)}{r.todayCheckin?.pain_location ? ` · ${r.todayCheckin.pain_location}` : ""}
                              </span>
                              <span className="block truncate text-[11px] text-muted">→ {actionText(r)}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-warn/40 bg-warn/15 p-3">
                <p className="text-xs font-semibold text-amber-300" title={d.bucketTipReduce}>
                  🟡 {d.briefingReduce} ({briefReduce.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefReduce.length === 0 ? (
                    <span className="text-xs text-white/50">{d.briefingNone}</span>
                  ) : (
                    <ul className="w-full space-y-1.5">
                      {briefReduce.map((r) => (
                        <li key={r.athlete.id}>
                          <Link
                            href={`/coach/athletes/${r.athlete.id}`}
                            className="flex items-center gap-2 rounded-lg border border-warn/40 bg-surface px-2 py-1.5 text-xs hover:bg-warn/10"
                          >
                            {avatarOf(r)}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2 font-medium">
                                <span className="truncate">{nameOf(r)}</span>
                                {r.todayScore !== null && (
                                  <span className="tabular-nums text-muted">
                                    {Math.round(r.todayScore)}
                                    {r.readinessDelta !== null && r.readinessDelta !== 0 && (
                                      <span className={r.readinessDelta < 0 ? "text-warn" : "text-ok"}>
                                        {" "}({r.readinessDelta > 0 ? "+" : ""}{r.readinessDelta})
                                      </span>
                                    )}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-warn">{reasonText(r)}</span>
                              <span className="block truncate text-[11px] text-muted">→ {actionText(r)}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs font-semibold text-white/60" title={d.bucketTipAsk}>
                  ⚪ {d.briefingAsk} ({briefAsk.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefAsk.length === 0 ? (
                    <span className="text-xs text-white/50">{d.briefingNone}</span>
                  ) : (
                    <ul className="w-full space-y-1.5">
                      {briefAsk.map((r) => (
                        <li key={r.athlete.id}>
                          <Link
                            href={`/coach/athletes/${r.athlete.id}`}
                            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs hover:bg-foreground/5"
                          >
                            {avatarOf(r)}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{nameOf(r)}</span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted">{reasonText(r)}</span>
                              <span className="block truncate text-[11px] text-muted">→ {actionText(r)}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-ok/40 bg-ok/15 p-3">
                <p className="text-xs font-semibold text-emerald-300" title={d.bucketTipReady}>
                  🟢 {d.briefingReady} ({briefReady.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {briefReady.length === 0 ? (
                    <span className="text-xs text-white/50">{d.briefingNone}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {briefReady.map((r) => (
                        <Link
                          key={r.athlete.id}
                          href={`/coach/athletes/${r.athlete.id}`}
                          className="rounded-lg border border-ok/30 bg-surface px-2 py-1 text-xs font-medium hover:bg-ok/10"
                        >
                          {nameOf(r)}
                          {r.todayScore !== null ? ` · ${Math.round(r.todayScore)}` : ""}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {todayTrainings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{d.todayTraining}</span>
              <Link href="/coach/attendance" className="text-xs font-medium text-accent">
                {dict.nav.attendance} →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {todayTrainings.map((t) => (
                <li key={t.group.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="font-medium">{t.group.name}</span>
                  <span className="tabular-nums text-muted">
                    {t.time ? `${t.time} · ` : ""}
                    {t.plan.planned_minutes != null && t.plan.planned_rpe != null
                      ? d.planLine
                          .replace("{min}", String(t.plan.planned_minutes))
                          .replace("{rpe}", String(t.plan.planned_rpe))
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {aiOn && briefGroupId && (
        <AIInsightCard
          target={{ kind: "group", id: briefGroupId }}
          initial={groupInsight}
          d={dict.ai}
          names={Object.fromEntries(rows.map((r) => [r.athlete.athlete_code, nameOf(r)]))}
        />
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

      {/* Secondary analytics — load wave + group readiness trend. */}
      {rows.length > 0 && (wave14Days.some((day) => day.load > 0) || readinessTrend.some((p) => p.score !== null)) && (
        <div className="grid gap-4 lg:grid-cols-2">
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
                    planned: x.planned,
                    wave: wave14.tags.get(x.date) ?? null,
                  }))}
                  label={dict.dashboard.factGroup}
                  plannedLabel={dict.dashboard.plan}
                />
                <p className="text-[11px] text-muted">{dict.dashboard.waveLegend}</p>
                <DataCoverageIndicator
                  pct={waveCoveragePct}
                  label={dict.dashboard.waveCoverageShort
                    .replace("{n}", String(waveMaxN))
                    .replace("{total}", String(waveAthletes))}
                />
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

          {readinessTrend.some((p) => p.score !== null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{d.readinessTrendTitle}</CardTitle>
                <p className="text-xs text-muted">{d.readinessTrendHint}</p>
              </CardHeader>
              <CardContent>
                <SeriesLineChart
                  data={readinessTrend}
                  series={[
                    {
                      key: "score",
                      label: dict.history.readiness,
                      color: "var(--chart-1)",
                      fill: true,
                    },
                  ]}
                  domain={[0, 100]}
                  height={180}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {groupPainEntries.length > 0 && (
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4">
            <span className="text-base font-semibold">📊 {d.groupHealthTitle}</span>
            <span className="flex items-center gap-2 text-xs text-muted">
              {d.groupHealthHint}
              <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="space-y-4 px-4 pb-4">
            <Card>
              <CardHeader>
                <CardTitle>{dict.pro.bodyMapGroupTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <GroupBodyHeatmap entries={groupPainEntries} dict={dict} />
              </CardContent>
            </Card>
          </div>
        </details>
      )}
    </div>
  );
}


