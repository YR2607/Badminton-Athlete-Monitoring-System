import { createClient } from "@/lib/supabase/server";
import { GroupReport } from "./group-report";
import { ReportBuilder } from "./report-builder";
import { PeriodBar } from "./period-bar";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { dateRange, localDate, resolveRange, type RangeKey } from "@/lib/dates";
import { athleteStats } from "@/lib/analytics";
import { dailyReadiness, postsByLocalDate, personalNorm } from "@/lib/readiness";
import { dailyLoads, loadCoverage, plannedForDate } from "@/lib/load";
import { attendanceSummary, effectiveAttendance } from "@/lib/attendance";
import { detectBodyZone } from "@/lib/body-zones";
import { LoadBarChart } from "@/components/charts/series-chart";
import { PrintButton } from "./print-button";
import { summarizeAthleteTournaments } from "@/lib/tournaments";
import type { PlanOverride } from "@/lib/load";
import type {
  Alert, Athlete, AttendanceStatus, Group, MorningCheckin, PainReport,
  PostTrainingCheckin, Profile, Tournament, TournamentMatch, TournamentPlayer,
  TrainingSchedule, TrainingSession, GroupMembership,
} from "@/lib/types";

/** Period report — builder, group mode or detailed per-athlete view. */
export default async function CoachReportPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; group?: string; period?: string; from?: string; to?: string; cols?: string }>;
}) {
  const sp = await searchParams;
  const profile = await requireRole(["coach", "admin"]);
  const dict = getDictionary(profile.preferred_language);
  const d = dict.report;
  const supabase = await createClient();
  const tz = profile.timezone ?? "Europe/Chisinau";

  const period: RangeKey =
    sp.period === "month" ? "month"
    : sp.period === "30d" ? "30d"
    : sp.period === "custom" ? "custom"
    : "7d";
  const range = resolveRange(period, tz, { from: sp.from, to: sp.to });
  const days = dateRange(range.from, range.to);

  const { data: athletes } = await supabase.from("athletes").select("*");
  const allAthletes = (athletes as Athlete[]) ?? [];
  if (sp.group) {
    const cols = new Set(
      (sp.cols ?? "fill,score,au,pain,att,alerts").split(",").filter(Boolean),
    );
    return (
      <GroupReport
        groupId={sp.group}
        period={period}
        days={days}
        from={range.from}
        to={range.to}
        athletes={allAthletes}
        tz={tz}
        dict={dict}
        cols={cols}
      />
    );
  }
  const athlete = allAthletes.find((a) => a.id === sp.athlete);
  if (!athlete) {
    const [{ data: groups }, { data: profs }] = await Promise.all([
      supabase.from("groups").select("id, name"),
      supabase.from("profiles").select("id, display_name"),
    ]);
    const nameById = new Map(
      ((profs as Pick<Profile, "id" | "display_name">[]) ?? []).map((p) => [p.id, p.display_name]),
    );
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl font-bold">{d.builderTitle}</h1>
        <ReportBuilder
          groups={((groups as Pick<Group, "id" | "name">[]) ?? []).map((g) => ({ id: g.id, name: g.name }))}
          athletes={allAthletes
            .filter((a) => a.status === "active")
            .map((a) => ({ id: a.id, name: nameById.get(a.profile_id) ?? a.athlete_code }))}
          d={d}
        />
      </main>
    );
  }

  const { data: profRow } = await supabase
    .from("profiles").select("*").eq("id", athlete.profile_id).maybeSingle();
  const aProf = profRow as Profile | null;
  const aTz = aProf?.timezone ?? tz;
  const name = aProf?.display_name ?? athlete.athlete_code;
  const prevFrom = addDaysStr(range.from, -1); // need 1 day before range for prev-day load on pain

  const [ckRes, postRes, sesRes, alertRes, schedRes, ovRes, attRes, painRes, membRes, tSlotRes] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id)
        .gte("checkin_date", range.from).lte("checkin_date", range.to),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", athlete.id)
        .gte("submitted_at", `${prevFrom}T00:00:00Z`)
        .lte("submitted_at", `${range.to}T23:59:59Z`),
      supabase.from("training_sessions").select("*").eq("athlete_id", athlete.id)
        .gte("started_at", `${prevFrom}T00:00:00Z`)
        .lt("started_at", `${addDaysStr(range.to, 1)}T00:00:00Z`),
      supabase.from("alerts").select("*").eq("athlete_id", athlete.id)
        .gte("triggered_at", `${range.from}T00:00:00Z`)
        .lte("triggered_at", `${range.to}T23:59:59Z`),
      supabase.from("training_schedules").select("*").eq("active", true),
      supabase.from("session_plan_overrides").select("*")
        .gte("plan_date", prevFrom).lte("plan_date", range.to),
      supabase.from("attendance").select("att_date, status").eq("athlete_id", athlete.id)
        .gte("att_date", range.from).lte("att_date", range.to),
      supabase.from("pain_reports").select("*").eq("athlete_id", athlete.id)
        .gte("report_date", range.from).lte("report_date", range.to),
      supabase.from("group_memberships").select("group_id").eq("athlete_id", athlete.id).is("left_at", null),
      supabase.from("tournament_players").select("tournament_id").eq("athlete_id", athlete.id),
    ]);

  // Tournament results within the report period (tournaments are one-day events,
  // so filtering by played_on is enough).
  const myTournamentIds = [
    ...new Set(
      ((tSlotRes.data as Pick<TournamentPlayer, "tournament_id">[]) ?? []).map(
        (p) => p.tournament_id,
      ),
    ),
  ];
  let tSum = summarizeAthleteTournaments(athlete.id, [], [], []);
  if (myTournamentIds.length > 0) {
    const [ttRes, tpRes, tmRes] = await Promise.all([
      supabase.from("tournaments").select("*").in("id", myTournamentIds)
        .gte("played_on", range.from).lte("played_on", range.to),
      supabase.from("tournament_players").select("*").in("tournament_id", myTournamentIds),
      supabase.from("tournament_matches").select("*").in("tournament_id", myTournamentIds),
    ]);
    tSum = summarizeAthleteTournaments(
      athlete.id,
      (ttRes.data as Tournament[]) ?? [],
      (tpRes.data as TournamentPlayer[]) ?? [],
      (tmRes.data as TournamentMatch[]) ?? [],
    );
  }

  const checkins = (ckRes.data as MorningCheckin[]) ?? [];
  const allPosts = (postRes.data as PostTrainingCheckin[]) ?? [];
  const posts = allPosts.filter((p) => {
    const dt = localDate(new Date(p.submitted_at), aTz);
    return dt >= range.from && dt <= range.to;
  });
  const allSessions = (sesRes.data as TrainingSession[]) ?? [];
  const sessions = allSessions.filter((s) => {
    const dt = localDate(new Date(s.started_at), aTz);
    return dt >= range.from && dt <= range.to;
  });
  const alerts = (alertRes.data as Alert[]) ?? [];
  const painRows = (painRes.data as PainReport[]) ?? [];
  const membership = (membRes.data as Pick<GroupMembership, "group_id">[] | null)?.[0];
  const mySchedules = ((schedRes.data as (TrainingSchedule & { group_id: string })[]) ?? [])
    .filter((s) => s.group_id === membership?.group_id);
  const myOverrides = ((ovRes.data as (PlanOverride & { group_id?: string })[]) ?? [])
    .filter((o) => o.group_id === membership?.group_id);
  const attRows = (attRes.data as { att_date: string; status: AttendanceStatus }[]) ?? [];

  const stats = athleteStats(athlete.id, days, checkins, sessions, alerts, postsByLocalDate(posts, aTz), aTz);
  const allSessionInputs = allSessions.map((s) => ({
    date: localDate(new Date(s.started_at), aTz),
    rpe: s.session_rpe,
    minutes: s.duration_minutes,
  }));
  const sessionInputs = allSessionInputs.filter((s) => s.date >= range.from && s.date <= range.to);
  const sessionDates = new Set(sessionInputs.map((s) => s.date));
  const marksMap = new Map(attRows.map((a) => [a.att_date, a.status]));
  const att = attendanceSummary(days, mySchedules, myOverrides, sessionDates, marksMap);

  const attendanceMarks = {
    present: new Set(attRows.filter((a) => a.status === "present").map((a) => a.att_date)),
    absent: new Set(attRows.filter((a) => a.status !== "present").map((a) => a.att_date)),
  };
  const loadsWithPrev = dailyLoads([prevFrom, ...days], allSessionInputs, mySchedules, myOverrides, attendanceMarks);
  const loadByDate = new Map(loadsWithPrev.map((l) => [l.date, l]));
  const loads = loadsWithPrev.slice(1);
  const coverage = loadCoverage(loads);
  const overPlan = loads.filter((l) => l.state === "known" && l.planned != null && l.load > l.planned * 1.25).length;

  // Plan vs Actual aggregates
  const plans = days.map((day) => plannedForDate(day, mySchedules, myOverrides));
  const plannedDays = plans.filter((p) => p.scheduled);
  const plannedMin = plannedDays.reduce((a, p) => a + (p.planned_minutes ?? 0), 0);
  const plannedRpeVals = plannedDays.map((p) => p.planned_rpe).filter((v): v is number => v != null);
  const plannedAvgRpe = plannedRpeVals.length
    ? Number((plannedRpeVals.reduce((a, b) => a + b, 0) / plannedRpeVals.length).toFixed(1))
    : null;
  const plannedAU = loads.reduce((a, l) => a + (l.planned ?? 0), 0);

  const totalAU = loads.reduce((a, l) => a + (l.state === "known" ? l.load : 0), 0);
  const planPct = plannedAU > 0 ? Math.round((totalAU / plannedAU) * 100) : null;
  const knownSessions = sessionInputs.filter((s) => s.rpe != null && s.minutes != null);
  const actualMin = sessionInputs.reduce((a, s) => a + (s.minutes ?? 0), 0);
  const actualAvgRpe = knownSessions.length
    ? Number((knownSessions.reduce((a, s) => a + s.rpe!, 0) / knownSessions.length).toFixed(1))
    : null;
  const rpeDelta = actualAvgRpe != null && plannedAvgRpe != null
    ? Number((actualAvgRpe - plannedAvgRpe).toFixed(1))
    : null;

  // Readiness & load-tolerance comparison (morning score after heavy vs normal days)
  const series = dailyReadiness(checkins);
  const scoreByDate = new Map(series.map((s) => [s.date, s.score]));
  const ckByDate = new Map(checkins.map((c) => [c.checkin_date, c]));
  const norm = personalNorm(series, range.to);
  const belowNorm = norm ? series.filter((s) => s.score < norm.avg - norm.sd).length : null;

  const afterHeavy: number[] = [];
  const afterNormal: number[] = [];
  for (const day of days) {
    const sc = scoreByDate.get(day);
    if (sc == null) continue;
    const prev = loadByDate.get(addDaysStr(day, -1));
    if (prev && prev.state === "known" && prev.planned && prev.load > prev.planned * 1.15) {
      afterHeavy.push(sc);
    } else {
      afterNormal.push(sc);
    }
  }
  const avgArr = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgAfterHeavy = avgArr(afterHeavy);
  const avgAfterNormal = avgArr(afterNormal);

  // Unified pain list (pain_reports + morning + evening checkins), deduplicated per day+zone
  const zoneOf = (z: string) => (dict.pro.bodyZones as Record<string, string>)[z] ?? z;
  const painEvents: {
    date: string;
    zone: string;
    rawLoc: string | null;
    side: string | null;
    severity: number | null;
    onset: string | null;
    src: string;
  }[] = [];
  const seenPain = new Set<string>();
  const pushPain = (e: (typeof painEvents)[number]) => {
    const k = `${e.date}:${e.zone}:${e.src}`;
    if (seenPain.has(k)) return;
    seenPain.add(k);
    painEvents.push(e);
  };
  for (const p of painRows) {
    pushPain({
      date: p.report_date,
      zone: p.zone,
      rawLoc: p.notes,
      side: p.side,
      severity: p.severity,
      onset: p.onset,
      src: p.source === "morning" ? dict.nav.morning : dict.nav.training,
    });
  }
  for (const c of checkins) {
    if (c.pain_status === "none") continue;
    pushPain({
      date: c.checkin_date,
      zone: detectBodyZone(c.pain_location) ?? c.pain_status,
      rawLoc: c.pain_location,
      side: c.pain_side,
      severity: c.pain_severity,
      onset: c.pain_onset,
      src: dict.nav.morning,
    });
  }
  for (const p of posts) {
    if (p.pain_status === "none") continue;
    pushPain({
      date: localDate(new Date(p.submitted_at), aTz),
      zone: detectBodyZone(p.pain_location) ?? p.pain_status,
      rawLoc: p.pain_location,
      side: p.pain_side,
      severity: p.pain_severity,
      onset: p.pain_onset,
      src: dict.nav.training,
    });
  }
  painEvents.sort((a, b) => a.date.localeCompare(b.date));
  const zoneCounts = new Map<string, number>();
  for (const e of painEvents) zoneCounts.set(e.zone, (zoneCounts.get(e.zone) ?? 0) + 1);

  const fmtLoadCtx = (day: string) => {
    const l = loadByDate.get(day);
    if (!l || l.state !== "known" || l.load === 0) return d.noLoadPrev;
    return `${l.load} AU${l.planned ? ` (${d.planShort} ${l.planned})` : ""}`;
  };

  const chartData = loads.map((l) => ({ date: l.date, load: l.load, planned: l.planned, state: l.state }));

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex gap-3 text-sm">
          <a href={`/coach/athletes/${athlete.id}?tab=load&range=${period}&from=${range.from}&to=${range.to}`} className="text-accent">← {name}</a>
          <a href="/coach/report" className="text-muted hover:text-foreground">· {d.changeFilter}</a>
        </div>
        <PrintButton label={d.print} />
      </div>

      <PeriodBar
        baseHref={`/coach/report?athlete=${athlete.id}`}
        period={period}
        from={range.from}
        to={range.to}
        d={d}
      />

      <header>
        <h1 className="text-2xl font-bold">{d.title}: {name}</h1>
        <p className="text-sm text-muted">
          {range.from} → {range.to} · {d.coverage
            .replace("{filled}", String(stats.filled))
            .replace("{expected}", String(stats.expected))
            .replace("{pct}", String(stats.rate))}
        </p>
      </header>

      {/* Main comparison table: Coach plan vs Athlete actual */}
      <section className="overflow-x-auto rounded-xl border border-border">
        <div className="border-b border-border p-3">
          <h2 className="font-semibold">{d.cmpTitle}</h2>
          <p className="text-xs text-muted">AU — {d.auExplain}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="p-2.5">{d.cmpMetric}</th>
              <th className="p-2.5">{d.cmpPlanned}</th>
              <th className="p-2.5">{d.cmpActual}</th>
              <th className="p-2.5">{d.cmpDiff}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b border-border/50">
              <td className="p-2.5 font-medium">{d.cmpTrainings}</td>
              <td className="p-2.5">{att.scheduled}</td>
              <td className="p-2.5">
                <b>{att.attended}</b>
                {att.absent > 0 ? <span className="text-xs text-danger"> ({d.absent}: {att.absent})</span> : null}
                {att.excused > 0 ? <span className="text-xs text-muted"> ({d.excused}: {att.excused})</span> : null}
              </td>
              <td className="p-2.5">{att.rate != null ? `${att.rate}%` : "—"}</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="p-2.5 font-medium">{d.cmpMinutes}</td>
              <td className="p-2.5">{plannedMin || "—"}</td>
              <td className="p-2.5"><b>{actualMin || "—"}</b></td>
              <td className="p-2.5">
                {plannedMin > 0 && actualMin > 0 ? `${Math.round((actualMin / plannedMin) * 100)}%` : "—"}
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="p-2.5 font-medium">{d.cmpRpe}</td>
              <td className="p-2.5">{plannedAvgRpe ?? "—"}</td>
              <td className="p-2.5"><b>{actualAvgRpe ?? "—"}</b></td>
              <td className="p-2.5">
                {rpeDelta === null ? "—" : (
                  <span className={rpeDelta > 1 ? "text-danger font-medium" : rpeDelta < -1 ? "text-warn" : "text-ok"}>
                    {rpeDelta > 0 ? `+${rpeDelta}` : rpeDelta} ({rpeDelta > 0.5 ? d.rpeHarder : rpeDelta < -0.5 ? d.rpeEasier : d.rpeOnTarget})
                  </span>
                )}
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="p-2.5 font-medium">{d.cmpLoadAU}</td>
              <td className="p-2.5">{plannedAU || "—"}</td>
              <td className="p-2.5"><b>{totalAU || "—"}</b></td>
              <td className="p-2.5">
                {planPct != null ? `${planPct}%` : "—"}
                {overPlan > 0 ? <span className="text-xs text-warn"> · {d.overPlan}: {overPlan}</span> : null}
              </td>
            </tr>
            <tr>
              <td className="p-2.5 font-medium">{d.cmpCheckins}</td>
              <td className="p-2.5">{days.length} / {att.attended}</td>
              <td className="p-2.5"><b>{checkins.length}</b> / <b>{posts.length}</b></td>
              <td className="p-2.5">{stats.rate}%</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Load chart */}
      <section className="space-y-2 rounded-xl border border-border p-4 print:hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{d.loadChartTitle}</h2>
          <span className="text-xs text-muted">
            {coverage.reliable
              ? d.loadCoverage.replace("{pct}", String(coverage.pct))
              : d.loadUnreliable.replace("{pct}", String(coverage.pct))}
          </span>
        </div>
        <LoadBarChart
          data={chartData}
          height={170}
          label={dict.dashboard.fact}
          plannedLabel={dict.dashboard.plan}
        />
      </section>

      {/* Wellness + Load tolerance */}
      <section className="space-y-2 rounded-xl border border-border p-4">
        <h2 className="font-semibold">{d.wellness} · {d.recoveryImpact}</h2>
        <p className="text-sm">
          {d.avgReadiness}: <b>{stats.avgReadiness ?? "—"}</b>
          {norm ? <span className="text-muted"> (норма {Math.round(norm.avg)})</span> : null}
          {" · "}{d.avgSleep}: <b>{stats.avgSleep ?? "—"}/5</b>
          {" · "}{d.avgFatigue}: <b>{stats.avgFatigue ?? "—"}/5</b>
          {" · "}
          <span className="text-muted">
            {belowNorm === null ? d.noNorm : d.belowNorm.replace("{n}", String(belowNorm))}
          </span>
        </p>
        {(avgAfterHeavy !== null || avgAfterNormal !== null) && (
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-lg bg-foreground/5 p-2.5">
              <div className="text-muted">{d.scoreAfterHeavy}</div>
              <div className="mt-0.5 text-base font-bold tabular-nums">
                {avgAfterHeavy ?? "—"} <span className="text-xs font-normal text-muted">({afterHeavy.length} дн.)</span>
              </div>
            </div>
            <div className="rounded-lg bg-foreground/5 p-2.5">
              <div className="text-muted">{d.scoreAfterNormal}</div>
              <div className="mt-0.5 text-base font-bold tabular-nums">
                {avgAfterNormal ?? "—"} <span className="text-xs font-normal text-muted">({afterNormal.length} дн.)</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Pain reports + previous-day load context */}
      <section className="space-y-2 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{d.pain}</h2>
          <span className="text-xs text-muted">{d.painSummary.replace("{n}", String(painEvents.length))}</span>
        </div>
        {painEvents.length === 0 ? (
          <p className="text-sm text-muted">{d.noPain}</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              {d.painByZone}:{" "}
              {[...zoneCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([z, n]) => `${zoneOf(z)} ×${n}`)
                .join(" · ")}
            </p>
            <ul className="divide-y divide-border/60 text-sm">
              {painEvents.map((p, i) => {
                const prevDay = addDaysStr(p.date, -1);
                return (
                  <li key={i} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <b>{p.date}</b> ({p.src}) — <b>{zoneOf(p.zone)}</b>
                        {p.rawLoc && p.rawLoc !== p.zone ? ` (${p.rawLoc})` : ""}
                        {p.side && p.side !== "na" ? ` · ${p.side}` : ""}
                        {p.severity ? ` · ${d.severity} ${p.severity}/10` : ""}
                        {p.onset === "new" ? ` · ${d.newPain}` : p.onset === "same" ? ` · ${d.samePain}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted tabular-nums">
                      ↳ {d.prevDayLoad} ({prevDay.slice(5)}): <b>{fmtLoadCtx(prevDay)}</b>
                      {" · "}{d.sameDayLoad}: <b>{fmtLoadCtx(p.date)}</b>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {myTournamentIds.length > 0 && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="mb-2 font-semibold">{d.tournamentsTitle}</h2>
          {tSum.matchesPlayed === 0 ? (
            <p className="text-sm text-muted">{d.noTournaments}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { l: d.tournamentsPlayed, v: String(tSum.tournamentsPlayed) },
                  { l: d.matchesRecord, v: `${tSum.wins}-${tSum.losses}` },
                  { l: d.winRate, v: tSum.winRate !== null ? `${tSum.winRate}%` : "—" },
                  { l: d.pointsDiff, v: tSum.diff > 0 ? `+${tSum.diff}` : String(tSum.diff) },
                  { l: d.bestPlace, v: tSum.bestPlace !== null ? `#${tSum.bestPlace}` : "—" },
                ].map(({ l, v }) => (
                  <div key={l} className="rounded-lg bg-foreground/5 p-2.5">
                    <div className="text-xs text-muted">{l}</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              {tSum.placements.length > 0 && (
                <ul className="mt-2 divide-y divide-border/60 text-sm">
                  {tSum.placements.map((p) => (
                    <li key={p.tournamentId} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">
                        <b>{p.playedOn}</b> · {p.title}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        <b className="text-foreground">#{p.place}</b>/{p.total} ·{" "}
                        {dict.tournaments.winsOf
                          .replace("{wins}", String(p.wins))
                          .replace("{played}", String(p.played))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-2 font-semibold">{d.alerts}</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted">{d.noAlerts}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.id}>
                {a.triggered_at.slice(0, 10)} — {(dict.rules.items as Record<string, { name: string }>)[a.rule_code]?.name ?? a.rule_code}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-border">
        <h2 className="border-b border-border p-3 text-sm font-semibold">{d.dailyTitle}</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="p-2">{d.colDate}</th>
              <th className="p-2">{d.colScore}</th>
              <th className="p-2">{d.colSleep}</th>
              <th className="p-2">{d.colFatigue}</th>
              <th className="p-2">{d.colDayPlan}</th>
              <th className="p-2">{d.colDayFact}</th>
              <th className="p-2">{d.colAtt}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const ck = ckByDate.get(day);
              const ld = loadByDate.get(day);
              const eff = effectiveAttendance(day, marksMap, sessionDates);
              return (
                <tr key={day} className="border-b border-border/40 last:border-0 tabular-nums">
                  <td className="p-2">{day.slice(5)}</td>
                  <td className="p-2">{scoreByDate.get(day) ?? "—"}</td>
                  <td className="p-2">{ck?.sleep_score ?? "—"}</td>
                  <td className="p-2">{ck?.fatigue_score ?? "—"}</td>
                  <td className="p-2 text-muted">{ld?.planned ?? "—"}</td>
                  <td className="p-2">{ld && ld.state === "known" && ld.load > 0 ? ld.load : "—"}</td>
                  <td className="p-2">
                    {eff === "present" ? "✓" : eff === "absent" ? "✗" : eff === "excused" ? "◯" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="pt-2 text-center text-[10px] text-muted print:block">
        RallyMonitor · {localDate(new Date(), tz)} · {d.generatedFor} {name}
      </p>
    </main>
  );
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
