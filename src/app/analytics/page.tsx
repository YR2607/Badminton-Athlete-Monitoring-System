import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, dateRange, localDate, localDayUtcBounds, resolveRange, todayInTz, type RangeKey } from "@/lib/dates";
import { athleteStats, periodSummary, delta, type AthletePeriodStats } from "@/lib/analytics";
import { sessionDateByIdMap } from "@/lib/checkins";
import { dailyConditionSeries, postsByLocalDate } from "@/lib/readiness";
import { analyzeLoadWave } from "@/lib/load";
import { getFeatureFlags, flagEnabled } from "@/lib/flags";
import { CompareChart, type CompareAthlete } from "@/app/coach/compare";
import { LoadReadinessQuadrant, type QuadrantPoint } from "@/app/coach/quadrant";
import { LoadBarChart } from "@/components/charts/series-chart";
import type { Athlete, Alert, Group, MorningCheckin, OstrcZone, PostTrainingCheckin, Profile, TrainingSession } from "@/lib/types";
import { AnalyticsFilters, type AthleteOption } from "./filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function Delta({ d, invert }: { d: number | null; invert?: boolean }) {
  if (d === null || d === 0) return null;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={cn("text-xs font-normal", good ? "text-ok" : "text-danger")}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
    </span>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; athlete?: string; range?: string; from?: string; to?: string }>;
}) {
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const d = dict.analytics;
  const sp = await searchParams;
  const supabase = await createClient();
  const tz = me.timezone ?? "Europe/Chisinau";

  const range = resolveRange((sp.range as RangeKey) || "day", tz, { from: sp.from, to: sp.to });
  const days = dateRange(range.from, range.to);
  const prevDays = days.map((day) => addDays(day, -days.length));
  const prevFrom = prevDays[0];

  const [{ data: athletes }, { data: memberships }, { data: groups }, { data: profs }, flags] =
    await Promise.all([
      supabase.from("athletes").select("*"),
      supabase.from("group_memberships").select("athlete_id, group_id").is("left_at", null),
      supabase.from("groups").select("*").order("name"),
      supabase.from("profiles").select("*"),
      getFeatureFlags(),
    ]);
  const ostrcOn = flagEnabled(flags, "ostrc", null);

  const groupById = new Map(((groups as Group[]) ?? []).map((g) => [g.id, g]));
  const profById = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
  const groupOfAthlete = new Map<string, string>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    if (!groupOfAthlete.has(m.athlete_id)) groupOfAthlete.set(m.athlete_id, m.group_id);
  }

  const allAthletes = (athletes as Athlete[]) ?? [];

  // Scope: single athlete > group > everything visible
  let scoped = allAthletes;
  if (sp.athlete) {
    scoped = allAthletes.filter((a) => a.id === sp.athlete);
  } else if (sp.group) {
    scoped = allAthletes.filter((a) => groupOfAthlete.get(a.id) === sp.group);
  }
  const ids = scoped.map((a) => a.id);

  const coachToday = todayInTz(tz);
  const since14 = addDays(coachToday, -14);
  const fetchFrom = prevFrom < since14 ? prevFrom : since14;
  const tsStart = localDayUtcBounds(addDays(fetchFrom, -1), tz).start.toISOString();
  const tsEnd = localDayUtcBounds(addDays(range.to, 1), tz).end.toISOString();

  const [
    { data: checkins },
    { data: sessions },
    { data: posts },
    { data: alerts },
    { data: zRows },
    { data: oRows },
  ] = ids.length
    ? await Promise.all([
        supabase
          .from("morning_checkins")
          .select("*")
          .in("athlete_id", ids)
          .gte("checkin_date", fetchFrom)
          .lte("checkin_date", range.to),
        supabase
          .from("training_sessions")
          .select("*")
          .in("athlete_id", ids)
          .gte("started_at", tsStart)
          .lt("started_at", tsEnd),
        supabase
          .from("post_training_checkins")
          .select("*")
          .in("athlete_id", ids)
          .gte("submitted_at", tsStart)
          .lt("submitted_at", tsEnd),
        supabase
          .from("alerts")
          .select("*")
          .in("athlete_id", ids)
          .gte("triggered_at", tsStart)
          .lt("triggered_at", tsEnd),
        ostrcOn
          ? supabase.from("ostrc_zones").select("*").eq("active", true).order("sort_order")
          : Promise.resolve({ data: [] }),
        ostrcOn
          ? supabase
              .from("ostrc_responses")
              .select("athlete_id, zone_code, week_start_date, any_problem, substantial")
              .in("athlete_id", ids)
              .order("week_start_date", { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const inRange = (date: string) => date >= range.from && date <= range.to;
  const inPrev = (date: string) => date >= prevFrom && date <= addDays(range.from, -1);

  const checkinsAll = (checkins as MorningCheckin[]) ?? [];
  const sessionsAll = (sessions as TrainingSession[]) ?? [];
  const alertsAll = (alerts as Alert[]) ?? [];

  const tzOf = (a: Athlete) => profById.get(a.profile_id)?.timezone ?? tz;
  const postsAll = (posts as PostTrainingCheckin[]) ?? [];
  const postsOf = (a: Athlete) => {
    const aTz = tzOf(a);
    const aSessions = sessionsAll.filter((s) => s.athlete_id === a.id);
    const sessionDateById = sessionDateByIdMap(aSessions, aTz);
    return postsByLocalDate(
      postsAll.filter((p) => p.athlete_id === a.id),
      aTz,
      sessionDateById,
    );
  };

  const stats: AthletePeriodStats[] = scoped.map((a) => {
    const aTz = tzOf(a);
    return athleteStats(
      a.id,
      days,
      checkinsAll.filter((c) => c.athlete_id === a.id && inRange(c.checkin_date)),
      sessionsAll.filter((s) => s.athlete_id === a.id && inRange(localDate(new Date(s.started_at), aTz))),
      alertsAll.filter((al) => al.athlete_id === a.id && inRange(localDate(new Date(al.triggered_at), aTz))),
      postsOf(a),
      aTz,
    );
  });
  const prevStats = scoped.map((a) => {
    const aTz = tzOf(a);
    return athleteStats(
      a.id,
      prevDays,
      checkinsAll.filter((c) => c.athlete_id === a.id && inPrev(c.checkin_date)),
      sessionsAll.filter((s) => s.athlete_id === a.id && inPrev(localDate(new Date(s.started_at), aTz))),
      [],
      postsOf(a),
      aTz,
    );
  });

  const summary = periodSummary(stats);
  const prevSummary = periodSummary(prevStats);
  const single = scoped.length === 1 ? stats[0] : null;

  // Group-level visual blocks (moved from /coach): quadrant, compare chart, OSTRC prevalence.
  const sortedScoped = [...scoped].sort((a, b) =>
    (profById.get(a.profile_id)?.display_name ?? a.athlete_code).localeCompare(
      profById.get(b.profile_id)?.display_name ?? b.athlete_code,
    ),
  );
  const series14ByAthlete = new Map<string, { date: string; score: number }[]>();
  for (const a of sortedScoped) {
    const list = checkinsAll
      .filter((c) => c.athlete_id === a.id && c.checkin_date >= since14)
      .sort((x, y) => x.checkin_date.localeCompare(y.checkin_date));
    series14ByAthlete.set(
      a.id,
      dailyConditionSeries(list, postsOf(a)).filter((s) => s.date >= since14),
    );
  }
  const hasFlagged = sortedScoped.some((a) => {
    const st = stats.find((s) => s.athleteId === a.id);
    return (st?.painDays ?? 0) > 0 || (st?.alerts ?? 0) > 0;
  });
  const compareAthletes: CompareAthlete[] = sortedScoped.map((a, i) => {
    const st = stats.find((s) => s.athleteId === a.id);
    const flagged = (st?.painDays ?? 0) > 0 || (st?.alerts ?? 0) > 0;
    return {
      id: a.id,
      name: profById.get(a.profile_id)?.display_name ?? a.athlete_code,
      flagged: flagged || (!hasFlagged && i < 3),
      series: series14ByAthlete.get(a.id) ?? [],
    };
  });
  const quadrantPoints: QuadrantPoint[] = sortedScoped
    .map((a) => {
      const aTz = tzOf(a);
      const aToday = todayInTz(aTz);
      const since7 = addDays(aToday, -6);
      const ser = series14ByAthlete.get(a.id) ?? [];
      const todayPt = ser.find((p) => p.date === aToday);
      const lastPt = [...ser].reverse().find((p) => p.date <= aToday);
      const score = todayPt?.score ?? lastPt?.score ?? null;
      if (score === null) return null;
      const load = sessionsAll
        .filter((s) => {
          if (s.athlete_id !== a.id) return false;
          const sd = localDate(new Date(s.started_at), aTz);
          return sd >= since7 && sd <= aToday;
        })
        .reduce(
          (acc, s) =>
            acc +
            (s.session_rpe != null && s.duration_minutes != null
              ? s.session_rpe * s.duration_minutes
              : 0),
          0,
        );
      const hasPain = checkinsAll.some(
        (c) => c.athlete_id === a.id && c.checkin_date >= addDays(aToday, -1) && c.pain_status !== "none",
      );
      return {
        id: a.id,
        name: profById.get(a.profile_id)?.display_name ?? a.athlete_code,
        load,
        readiness: score,
        hasPain,
        isToday: Boolean(todayPt),
      };
    })
    .filter((p): p is QuadrantPoint => p !== null);

  // 14-day BWF load wave (mean active AU across scoped athletes who trained on each date).
  const wave14Days = dateRange(addDays(coachToday, -13), coachToday).map((dt) => {
    const dayTotals = new Map<string, number>();
    for (const s of sessionsAll) {
      if (s.session_rpe == null || s.duration_minutes == null) continue;
      const a = scoped.find((x) => x.id === s.athlete_id);
      if (!a) continue;
      const sd = localDate(new Date(s.started_at), tzOf(a));
      if (sd !== dt) continue;
      dayTotals.set(a.id, (dayTotals.get(a.id) ?? 0) + s.session_rpe * s.duration_minutes);
    }
    const vals = [...dayTotals.values()];
    const avg = vals.length
      ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length)
      : 0;
    return { date: dt, load: avg };
  });
  const wave14 = analyzeLoadWave(wave14Days);

  type ORow = { athlete_id: string; zone_code: string; week_start_date: string; any_problem: boolean; substantial: boolean };
  const allOstrc = (oRows as ORow[] | null) ?? [];
  const latestWeek = allOstrc[0]?.week_start_date ?? null;
  const ostrcPrev = latestWeek
    ? (((zRows as OstrcZone[] | null) ?? [])
        .map((z) => {
          const zr = allOstrc.filter((r) => r.week_start_date === latestWeek && r.zone_code === z.code);
          const n = zr.length;
          return {
            zone: z.code,
            name: z.name[me.preferred_language as "ru" | "en" | "ro"] || z.name.en || z.code,
            n,
            anyPct: n ? Math.round((zr.filter((r) => r.any_problem).length / n) * 100) : 0,
            subPct: n ? Math.round((zr.filter((r) => r.substantial).length / n) * 100) : 0,
          };
        })
        .filter((z) => z.n > 0))
    : [];

  const athleteOptions: AthleteOption[] = allAthletes.map((a) => ({
    id: a.id,
    label: `${profById.get(a.profile_id)?.display_name ?? a.athlete_code} (${a.athlete_code})`,
    groupId: groupOfAthlete.get(a.id) ?? null,
  }));

  const nameOf = (id: string) => {
    const a = scoped.find((x) => x.id === id);
    return a ? (profById.get(a.profile_id)?.display_name ?? a.athlete_code) : id;
  };

  const statCards: [string, string | number, number | null, boolean?, string?][] = [
    [d.checkins, `${summary.checkinsFilled}/${summary.checkinsExpected}`, delta(summary.fillRate, prevSummary.fillRate)],
    [d.sessions, summary.sessions, delta(summary.sessions, prevSummary.sessions)],
    [d.avgReadiness, summary.avgReadiness ?? "—", delta(summary.avgReadiness, prevSummary.avgReadiness), undefined, dict.common.readinessHint],
    [d.alertsCount, summary.alerts, delta(summary.alerts, prevSummary.alerts), true],
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{d.title}</h1>
        <p className="text-sm text-muted">{d.hint}</p>
      </div>

      <AnalyticsFilters
        dict={dict}
        groups={(groups as Group[]) ?? []}
        athletes={athleteOptions}
        current={{
          group: sp.group ?? "",
          athlete: sp.athlete ?? "",
          range: sp.range ?? "day",
          from: sp.from,
          to: sp.to,
        }}
      />

      {scoped.length === 0 ? (
        <p className="text-sm text-muted">{d.noAthletes}</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statCards.map(([label, value, dl, invert, hint]) => (
              <Card key={label as string}>
                <CardContent className="pt-3 pb-3">
                  <p className="text-lg font-bold tabular-nums">
                    {value} <Delta d={dl} invert={invert} />
                  </p>
                  <p className="text-xs text-muted" title={hint}>{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Fill matrix: athlete × day */}
          {!single && days.length <= 31 && (
            <Card>
              <CardHeader>
                <CardTitle>{d.completion}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="sticky left-0 bg-surface pb-2 pr-2 font-medium" />
                        {days.map((day) => (
                          <th key={day} className="pb-2 text-center font-medium">
                            {day.slice(8)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => (
                        <tr key={s.athleteId} className="border-t border-border/50">
                          <td className="sticky left-0 max-w-32 truncate bg-surface py-1.5 pr-2 font-medium">
                            <Link href={`/coach/athletes/${s.athleteId}`} className="text-accent">
                              {nameOf(s.athleteId)}
                            </Link>
                          </td>
                          {s.cells.map((c) => (
                            <td key={c.date} className="py-1.5 text-center">
                              <Link
                                href={`/coach/athletes/${s.athleteId}/day/${c.date}`}
                                className="inline-flex gap-0.5 rounded transition-transform hover:scale-125"
                              >
                                <span
                                  className={cn(
                                    "inline-block h-3 w-3 rounded-full",
                                    c.hasPain
                                      ? "bg-danger"
                                      : c.filled
                                        ? "bg-ok"
                                        : "bg-foreground/15",
                                  )}
                                  title={`${c.date} · ${d.dotMorning}: ${c.hasPain ? d.painDay : c.filled ? d.filled : d.missed}`}
                                />
                                <span
                                  className={cn(
                                    "inline-block h-3 w-3 rounded-full",
                                    c.evening
                                      ? "bg-accent"
                                      : c.hadSession
                                        ? "bg-warn/60"
                                        : "bg-foreground/15",
                                  )}
                                  title={`${c.date} · ${d.dotEvening}: ${c.evening ? d.filled : c.hadSession ? d.missed : d.dotNoSession}`}
                                />
                              </Link>
                            </td>
                          ))}
                          <td className="py-1.5 pl-2 font-semibold tabular-nums">{s.rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-ok" /> {d.dotMorning}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-accent" /> {d.dotEvening}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-warn/60" /> {d.dotNoSession}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-foreground/15" /> {d.missed}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-danger" /> {d.painDay}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-athlete cards (multi) */}
          {!single && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted">{d.byAthlete}</h2>
              {stats.map((s) => {
                const prev = prevStats.find((p) => p.athleteId === s.athleteId);
                const a = scoped.find((x) => x.id === s.athleteId)!;
                return (
                  <Link key={s.athleteId} href={`/coach/athletes/${s.athleteId}`} className="block">
                    <Card className="transition-colors hover:border-accent/50">
                      <CardContent className="space-y-2 pt-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{nameOf(s.athleteId)}</span>
                            <span className="text-xs text-muted">
                              {groupById.get(groupOfAthlete.get(a.id) ?? "")?.name ?? ""}
                            </span>
                          </div>
                          <span
                            title={dict.common.readinessHint}
                            className={cn(
                              "shrink-0 text-lg font-bold tabular-nums",
                              s.avgReadiness === null
                                ? "text-muted"
                                : s.avgReadiness >= 70
                                  ? "text-ok"
                                  : s.avgReadiness >= 45
                                    ? "text-warn"
                                    : "text-danger",
                            )}
                          >
                            {s.avgReadiness ?? "—"}
                            {prev && <Delta d={delta(s.avgReadiness, prev.avgReadiness)} />}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          <span>
                            {d.checkins}: {s.filled}/{s.expected} ({s.rate}%)
                          </span>
                          <span>{d.sessions}: {s.sessions}</span>
                          {s.painDays > 0 && <Badge tone="danger">{d.painDays}: {s.painDays}</Badge>}
                          {s.alerts > 0 && <Badge tone="warn">{d.alertsCount}: {s.alerts}</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Single athlete: day-by-day */}
          {single && (
            <Card>
              <CardHeader>
                <CardTitle>{d.byDay}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border/60">
                  {[...single.cells].reverse().map((c) => {
                    const ci = checkinsAll.find(
                      (x) => x.athlete_id === single.athleteId && x.checkin_date === c.date,
                    );
                    const daySessions = sessionsAll.filter(
                      (s) =>
                        s.athlete_id === single.athleteId &&
                        localDate(new Date(s.started_at), tzOf(scoped[0])) === c.date,
                    );
                    return (
                      <Link
                        key={c.date}
                        href={`/coach/athletes/${single.athleteId}/day/${c.date}`}
                        className="-mx-1 flex items-center gap-3 rounded-lg px-1 py-2 text-sm transition-colors hover:bg-foreground/5"
                      >
                        <span className="w-20 shrink-0 font-medium">{c.date}</span>
                        <span className="flex shrink-0 gap-0.5">
                          <span
                            title={d.dotMorning}
                            className={cn(
                              "h-3 w-3 rounded-full",
                              c.hasPain ? "bg-danger" : c.filled ? "bg-ok" : "bg-foreground/15",
                            )}
                          />
                          <span
                            title={d.dotEvening}
                            className={cn(
                              "h-3 w-3 rounded-full",
                              c.evening
                                ? "bg-accent"
                                : c.hadSession
                                  ? "bg-warn/60"
                                  : "bg-foreground/15",
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1 text-muted">
                          {c.filled ? (
                            <>
                              {dict.history.sleep} {ci!.sleep_score} · {dict.history.fatigue}{" "}
                              {ci!.fatigue_score} · {dict.history.mood} {ci!.mood_score}
                              {c.hasPain ? ` · ${d.painDay}!` : ""}
                            </>
                          ) : (
                            d.missed
                          )}
                        </span>
                        {daySessions.length > 0 && (
                          <span className="shrink-0 text-xs text-muted tabular-nums">
                            {d.sessions}: {daySessions.length}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* BWF 14-day load wave (peaks 🔴 & deloads 🟢) */}
          {wave14Days.some((d) => d.load > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>{dict.dashboard.waveTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <LoadBarChart
                  data={wave14Days.map((x) => ({
                    date: x.date.slice(5),
                    load: x.load,
                    wave: wave14.tags.get(x.date) ?? null,
                  }))}
                  label={dict.dashboard.fact}
                />
                {wave14.status !== "insufficient" && (
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                      wave14.status === "monotonous"
                        ? "border-warn/40 bg-warn/10 text-warn"
                        : "border-ok/30 bg-ok/5 text-ok"
                    }`}
                  >
                    <span className="font-medium">
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

          {/* Group-level charts (when viewing >1 athlete) */}
          {!single && quadrantPoints.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{dict.coach.quadrantTitle}</CardTitle>
                <p className="text-xs text-muted">{dict.coach.quadrantHint}</p>
              </CardHeader>
              <CardContent>
                <LoadReadinessQuadrant points={quadrantPoints} dict={dict} />
              </CardContent>
            </Card>
          )}

          {!single && ostrcPrev.length > 0 && (
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
                        {dict.ostrc.anyProblem}:{" "}
                        <b className={z.anyPct ? "text-warn" : ""}>{z.anyPct}%</b>
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

          {!single && (
            <Card>
              <CardHeader>
                <CardTitle>{dict.coach.compare}</CardTitle>
                <p className="text-xs text-muted">{dict.coach.compareHint}</p>
              </CardHeader>
              <CardContent>
                <CompareChart athletes={compareAthletes} dict={dict} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
