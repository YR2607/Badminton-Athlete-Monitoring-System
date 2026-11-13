import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/dates";
import { athleteStats } from "@/lib/analytics";
import { postsByLocalDate } from "@/lib/readiness";
import { plannedForDate, type PlanOverride } from "@/lib/load";
import { attendanceSummary } from "@/lib/attendance";
import { detectBodyZone } from "@/lib/body-zones";
import { LoadBarChart } from "@/components/charts/series-chart";
import { EmptyChart, InsightLine, StatCard } from "@/components/charts/chart-ui";
import { PrintButton } from "./print-button";
import { PeriodBar } from "./period-bar";
import type { Dictionary } from "@/i18n";
import type {
  Alert, Athlete, AttendanceStatus, Group, MorningCheckin,
  PainReport, PostTrainingCheckin, Profile, TrainingSchedule, TrainingSession,
} from "@/lib/types";

/** Whole-group period report — summary + load chart + per-athlete rows, printable. */
export async function GroupReport({
  groupId,
  period,
  days,
  from,
  to,
  athletes,
  tz,
  dict,
  cols,
}: {
  groupId: string;
  period: string;
  days: string[];
  from: string;
  to: string;
  athletes: Athlete[];
  tz: string;
  dict: Dictionary;
  cols: Set<string>;
}) {
  const d = dict.report;
  const supabase = await createClient();

  const [{ data: group }, { data: members }, { data: profs }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
    supabase.from("group_memberships").select("athlete_id").eq("group_id", groupId).is("left_at", null),
    supabase.from("profiles").select("id, display_name, timezone"),
  ]);
  const ids = ((members as { athlete_id: string }[]) ?? []).map((m) => m.athlete_id);
  const profById = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
  const rows = athletes.filter((a) => ids.includes(a.id) && a.status === "active");
  if (!group || rows.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-muted">{d.noAthlete}</p>
      </main>
    );
  }

  const [ckRes, postRes, sesRes, alertRes, attRes, painRes, schedRes, ovRes] = await Promise.all([
    supabase.from("morning_checkins").select("*").in("athlete_id", ids)
      .gte("checkin_date", from).lte("checkin_date", to),
    supabase.from("post_training_checkins").select("*").in("athlete_id", ids)
      .gte("submitted_at", `${from}T00:00:00Z`).lte("submitted_at", `${to}T23:59:59Z`),
    supabase.from("training_sessions").select("*").in("athlete_id", ids)
      .gte("started_at", `${from}T00:00:00Z`).lt("started_at", `${to}T23:59:59Z`),
    supabase.from("alerts").select("*").in("athlete_id", ids)
      .gte("triggered_at", `${from}T00:00:00Z`).lte("triggered_at", `${to}T23:59:59Z`),
    supabase.from("attendance").select("athlete_id, att_date, status").in("athlete_id", ids)
      .gte("att_date", from).lte("att_date", to),
    supabase.from("pain_reports").select("*").in("athlete_id", ids)
      .gte("report_date", from).lte("report_date", to),
    supabase.from("training_schedules").select("*").eq("group_id", groupId).eq("active", true),
    supabase.from("session_plan_overrides").select("*").eq("group_id", groupId)
      .gte("plan_date", from).lte("plan_date", to),
  ]);
  const checkins = (ckRes.data as MorningCheckin[]) ?? [];
  const posts = (postRes.data as PostTrainingCheckin[]) ?? [];
  const sessions = (sesRes.data as TrainingSession[]) ?? [];
  const alerts = (alertRes.data as Alert[]) ?? [];
  const attendance = (attRes.data as { athlete_id: string; att_date: string; status: AttendanceStatus }[]) ?? [];
  const pains = (painRes.data as PainReport[]) ?? [];
  const schedules = (schedRes.data as TrainingSchedule[]) ?? [];
  const overrides = (ovRes.data as PlanOverride[]) ?? [];

  const plans = days.map((day) => plannedForDate(day, schedules, overrides));
  const plannedTotal = plans.reduce((sum, p) => sum + (p.planned ?? 0), 0);
  const plannedRpes = plans.map((p) => p.planned_rpe).filter((v): v is number => v != null);
  const plannedAvgRpe = plannedRpes.length
    ? Number((plannedRpes.reduce((a, b) => a + b, 0) / plannedRpes.length).toFixed(1))
    : null;
  const zoneOf = (z: string) => (dict.pro.bodyZones as Record<string, string>)[z] ?? z;

  const rowsOut = rows.map((a) => {
    const aTz = profById.get(a.profile_id)?.timezone ?? tz;
    const mySes = sessions.filter((s) => s.athlete_id === a.id);
    const myCk = checkins.filter((c) => c.athlete_id === a.id);
    const myPosts = posts.filter((p) => p.athlete_id === a.id);
    const st = athleteStats(
      a.id, days, myCk, mySes,
      alerts.filter((x) => x.athlete_id === a.id),
      postsByLocalDate(myPosts, aTz), aTz,
    );
    const known = mySes.filter((s) => s.session_rpe != null && s.duration_minutes != null);
    const au = known.reduce((x, s) => x + s.session_rpe! * s.duration_minutes!, 0);
    const avgRpe = known.length
      ? Number((known.reduce((x, s) => x + s.session_rpe!, 0) / known.length).toFixed(1))
      : null;
    const sessionDates = new Set(mySes.map((s) => localDate(new Date(s.started_at), aTz)));
    const marksMap = new Map(
      attendance.filter((x) => x.athlete_id === a.id).map((x) => [x.att_date, x.status]),
    );
    const att = attendanceSummary(days, schedules, overrides, sessionDates, marksMap);

    // Unified pain count + top zone
    const myZones: string[] = [
      ...pains.filter((p) => p.athlete_id === a.id).map((p) => p.zone),
      ...myCk.filter((c) => c.pain_status !== "none").map((c) => detectBodyZone(c.pain_location) ?? c.pain_status),
      ...myPosts.filter((p) => p.pain_status !== "none").map((p) => detectBodyZone(p.pain_location) ?? p.pain_status),
    ];
    const zCount = new Map<string, number>();
    for (const z of myZones) zCount.set(z, (zCount.get(z) ?? 0) + 1);
    const topZone = [...zCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const maxSev = Math.max(
      0,
      ...pains.filter((p) => p.athlete_id === a.id).map((p) => p.severity ?? 0),
      ...myCk.map((c) => c.pain_severity ?? 0),
      ...myPosts.map((p) => p.pain_severity ?? 0),
    );
    return {
      a,
      name: profById.get(a.profile_id)?.display_name ?? a.athlete_code,
      st,
      au,
      avgRpe,
      pctPlan: plannedTotal > 0 && au > 0 ? Math.round((au / plannedTotal) * 100) : null,
      pain: myZones.length,
      topZone,
      maxSev,
      att,
      openAlerts: alerts.filter((x) => x.athlete_id === a.id && x.status === "open").length,
    };
  });

  // Group daily load chart (coach plan vs athlete mean)
  const chartData = days.map((day) => {
    const dayLoads = rowsOut
      .map((r) => {
        const aTz = profById.get(r.a.profile_id)?.timezone ?? tz;
        return sessions
          .filter((s) => s.athlete_id === r.a.id && localDate(new Date(s.started_at), aTz) === day)
          .reduce((x, s) => x + (s.session_rpe ?? 0) * (s.duration_minutes ?? 0), 0);
      })
      .filter((v) => v > 0);
    return {
      date: day,
      load: dayLoads.length ? Math.round(dayLoads.reduce((a, b) => a + b, 0) / dayLoads.length) : 0,
      planned: plannedForDate(day, schedules, overrides).planned,
    };
  });

  const scores = rowsOut.map((r) => r.st.avgReadiness).filter((v): v is number => v != null);
  const avgGroupScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  const avgGroupAU = Math.round(rowsOut.reduce((a, r) => a + r.au, 0) / rowsOut.length);
  const attRates = rowsOut.map((r) => r.att.rate).filter((v): v is number => v != null);
  const avgAttRate = attRates.length
    ? Math.round(attRates.reduce((a, b) => a + b, 0) / attRates.length)
    : null;
  // Needs-attention = pain report, open alert, or a low average score.
  const needAttention = rowsOut.filter(
    (r) => r.pain > 0 || r.openAlerts > 0 || (r.st.avgReadiness !== null && r.st.avgReadiness < 45),
  ).length;
  const fillExpected = rowsOut.reduce((a, r) => a + r.st.expected, 0);
  const fillPct = fillExpected
    ? Math.round((rowsOut.reduce((a, r) => a + r.st.filled, 0) / fillExpected) * 100)
    : null;
  const colsParam = [...cols].join(",");

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href="/coach/report" className="text-sm text-accent">← {d.changeFilter}</a>
        <PrintButton label={d.print} />
      </div>

      <PeriodBar
        baseHref={`/coach/report?group=${groupId}&cols=${colsParam}`}
        period={period}
        from={from}
        to={to}
        d={d}
      />

      <header>
        <h1 className="text-2xl font-bold">{d.groupTitle}: {(group as Group).name}</h1>
        <p className="text-sm text-muted">{from} → {to}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={d.groupAvgScore}
          value={avgGroupScore ?? "—"}
          hint={dict.common.readinessHint}
          tone={avgGroupScore === null ? "neutral" : avgGroupScore >= 70 ? "ok" : avgGroupScore >= 45 ? "warn" : "danger"}
        />
        <StatCard
          label={d.groupAvgLoad}
          value={`${avgGroupAU} / ${plannedTotal || "—"} AU`}
          hint={d.auExplain}
        />
        <StatCard
          label={d.groupAttRate}
          value={avgAttRate != null ? `${avgAttRate}%` : "—"}
        />
        <StatCard
          label={d.groupAttention}
          value={`${needAttention} / ${rowsOut.length}`}
          tone={needAttention === 0 ? "ok" : needAttention <= Math.ceil(rowsOut.length / 4) ? "warn" : "danger"}
        />
      </section>
      {fillPct !== null && fillPct < 60 && (
        <InsightLine tone="warn">
          {d.groupLowCoverage.replace("{pct}", String(fillPct))}
        </InsightLine>
      )}

      {cols.has("au") && (
        <section className="rounded-xl border border-border p-4 print:hidden">
          <h2 className="text-sm font-semibold">{d.loadChartTitle}</h2>
          <p className="mb-2 text-xs text-muted">{d.auExplain}</p>
          {chartData.every((x) => x.load === 0 && (x.planned == null || x.planned === 0)) ? (
            <EmptyChart text={dict.common.noData} height={120} />
          ) : (
            <LoadBarChart
              data={chartData}
              height={170}
              label={dict.dashboard.fact}
              plannedLabel={dict.dashboard.plan}
            />
          )}
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="p-2.5">{d.colAthlete}</th>
              {cols.has("att") && <th className="p-2.5">{d.colTrainings}</th>}
              {cols.has("fill") && <th className="p-2.5">{d.colFill}</th>}
              {cols.has("score") && <th className="p-2.5">{d.colScore}</th>}
              {cols.has("au") && <th className="p-2.5">{d.colRpePlanFact}</th>}
              {cols.has("au") && <th className="p-2.5">{d.factVsPlan} (AU)</th>}
              {cols.has("pain") && <th className="p-2.5">{d.colPain}</th>}
              {cols.has("alerts") && <th className="p-2.5">{d.colAlerts}</th>}
            </tr>
          </thead>
          <tbody>
            {rowsOut.map((r) => (
              <tr key={r.a.id} className="border-b border-border/50 last:border-0">
                <td className="p-2.5 font-medium">
                  <a href={`/coach/report?athlete=${r.a.id}&period=custom&from=${from}&to=${to}`}
                     className="text-accent hover:underline print:text-foreground print:no-underline">
                    {r.name}
                  </a>
                </td>
                {cols.has("att") && (
                  <td className="p-2.5 tabular-nums">
                    {r.att.scheduled === 0
                      ? "—"
                      : `${r.att.attended}/${r.att.scheduled} (${r.att.rate ?? 0}%)`}
                  </td>
                )}
                {cols.has("fill") && (
                  <td className="p-2.5 tabular-nums">{r.st.filled}/{r.st.expected} ({r.st.rate}%)</td>
                )}
                {cols.has("score") && (
                  <td
                    className={`p-2.5 tabular-nums font-semibold ${
                      r.st.avgReadiness === null
                        ? "text-muted"
                        : r.st.avgReadiness >= 70
                          ? "text-ok"
                          : r.st.avgReadiness >= 45
                            ? "text-warn"
                            : "text-danger"
                    }`}
                  >
                    {r.st.avgReadiness ?? "—"}
                  </td>
                )}
                {cols.has("au") && (
                  <td className="p-2.5 tabular-nums">
                    {r.avgRpe ?? "—"} / {plannedAvgRpe ?? "—"}
                  </td>
                )}
                {cols.has("au") && (
                  <td className="p-2.5 tabular-nums">
                    {r.au ? `${r.au} / ${plannedTotal || "—"}` : "—"}
                    {r.pctPlan != null ? <span className="text-xs text-muted"> ({r.pctPlan}%)</span> : null}
                  </td>
                )}
                {cols.has("pain") && (
                  <td className="p-2.5">
                    {r.pain === 0 ? (
                      "—"
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.maxSev >= 7 ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"
                        }`}
                      >
                        {r.pain}
                        {r.topZone ? ` · ${zoneOf(r.topZone)}` : ""}
                      </span>
                    )}
                  </td>
                )}
                {cols.has("alerts") && (
                  <td className={`p-2.5 tabular-nums ${r.openAlerts > 0 ? "font-semibold text-warn" : ""}`}>
                    {r.openAlerts || "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted">
        {d.groupLegend.replace("{n}", String(rowsOut.length))} · {localDate(new Date(), tz)}
      </p>
    </main>
  );
}
