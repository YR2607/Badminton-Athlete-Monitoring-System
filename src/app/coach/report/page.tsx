import { createClient } from "@/lib/supabase/server";
import { GroupReport } from "./group-report";
import { ReportBuilder } from "./report-builder";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { dateRange, localDate, resolveRange, type RangeKey } from "@/lib/dates";
import { athleteStats } from "@/lib/analytics";
import { dailyReadiness, postsByLocalDate, personalNorm } from "@/lib/readiness";
import { dailyLoads, loadCoverage } from "@/lib/load";
import { attendanceSummary, effectiveAttendance } from "@/lib/attendance";
import { LoadBarChart } from "@/components/charts/series-chart";
import { PrintButton } from "./print-button";
import type { PlanOverride } from "@/lib/load";
import type {
  Alert, Athlete, AttendanceStatus, Group, MorningCheckin, PainReport,
  PostTrainingCheckin, Profile, TrainingSchedule, TrainingSession, GroupMembership,
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
    sp.period === "month" ? "month" : sp.period === "custom" ? "custom" : "7d";
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

  const [ckRes, postRes, sesRes, alertRes, schedRes, ovRes, attRes, painRes, membRes] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id)
        .gte("checkin_date", range.from).lte("checkin_date", range.to),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", athlete.id)
        .gte("submitted_at", `${addDaysStr(range.from, -1)}T00:00:00Z`)
        .lte("submitted_at", `${range.to}T23:59:59Z`),
      supabase.from("training_sessions").select("*").eq("athlete_id", athlete.id)
        .gte("started_at", `${range.from}T00:00:00Z`)
        .lt("started_at", `${addDaysStr(range.to, 1)}T00:00:00Z`),
      supabase.from("alerts").select("*").eq("athlete_id", athlete.id)
        .gte("triggered_at", `${range.from}T00:00:00Z`)
        .lte("triggered_at", `${range.to}T23:59:59Z`),
      supabase.from("training_schedules").select("*").eq("active", true),
      supabase.from("session_plan_overrides").select("*")
        .gte("plan_date", range.from).lte("plan_date", range.to),
      supabase.from("attendance").select("att_date, status").eq("athlete_id", athlete.id)
        .gte("att_date", range.from).lte("att_date", range.to),
      supabase.from("pain_reports").select("*").eq("athlete_id", athlete.id)
        .gte("report_date", range.from).lte("report_date", range.to),
      supabase.from("group_memberships").select("group_id").eq("athlete_id", athlete.id).is("left_at", null),
    ]);

  const checkins = (ckRes.data as MorningCheckin[]) ?? [];
  const posts = (postRes.data as PostTrainingCheckin[]) ?? [];
  const sessions = (sesRes.data as TrainingSession[]) ?? [];
  const alerts = (alertRes.data as Alert[]) ?? [];
  const pains = (painRes.data as PainReport[]) ?? [];
  const membership = (membRes.data as Pick<GroupMembership, "group_id">[] | null)?.[0];
  const mySchedules = ((schedRes.data as (TrainingSchedule & { group_id: string })[]) ?? [])
    .filter((s) => s.group_id === membership?.group_id);
  const myOverrides = ((ovRes.data as (PlanOverride & { group_id?: string })[]) ?? [])
    .filter((o) => o.group_id === membership?.group_id);
  const attRows = (attRes.data as { att_date: string; status: AttendanceStatus }[]) ?? [];

  const stats = athleteStats(athlete.id, days, checkins, sessions, alerts, postsByLocalDate(posts, aTz), aTz);
  const sessionInputs = sessions.map((s) => ({
    date: localDate(new Date(s.started_at), aTz),
    rpe: s.session_rpe,
    minutes: s.duration_minutes,
  }));
  const sessionDates = new Set(sessionInputs.map((s) => s.date));
  const marksMap = new Map(attRows.map((a) => [a.att_date, a.status]));
  const att = attendanceSummary(days, mySchedules, myOverrides, sessionDates, marksMap);

  const attendanceMarks = {
    present: new Set(attRows.filter((a) => a.status === "present").map((a) => a.att_date)),
    absent: new Set(attRows.filter((a) => a.status !== "present").map((a) => a.att_date)),
  };
  const loads = dailyLoads(days, sessionInputs, mySchedules, myOverrides, attendanceMarks);
  const coverage = loadCoverage(loads);
  const overPlan = loads.filter((l) => l.state === "known" && l.planned != null && l.load > l.planned * 1.25).length;
  const totalAU = loads.reduce((a, l) => a + (l.state === "known" ? l.load : 0), 0);
  const plannedAU = loads.reduce((a, l) => a + (l.planned ?? 0), 0);
  const planPct = plannedAU > 0 ? Math.round((totalAU / plannedAU) * 100) : null;
  const knownSessions = sessionInputs.filter((s) => s.rpe != null && s.minutes != null);
  const avgRpe = knownSessions.length
    ? (knownSessions.reduce((a, s) => a + s.rpe!, 0) / knownSessions.length).toFixed(1)
    : "—";
  const avgMin = knownSessions.length
    ? Math.round(knownSessions.reduce((a, s) => a + s.minutes!, 0) / knownSessions.length)
    : "—";
  const avgSessionAU = knownSessions.length ? Math.round(totalAU / knownSessions.length) : "—";

  const series = dailyReadiness(checkins);
  const scoreByDate = new Map(series.map((s) => [s.date, s.score]));
  const ckByDate = new Map(checkins.map((c) => [c.checkin_date, c]));
  const loadByDate = new Map(loads.map((l) => [l.date, l]));
  const norm = personalNorm(series, range.to);
  const belowNorm = norm ? series.filter((s) => s.score < norm.avg - norm.sd).length : null;

  const zoneOf = (z: string) => (dict.pro.bodyZones as Record<string, string>)[z] ?? z;
  const chartData = loads.map((l) => ({ date: l.date, load: l.load, planned: l.planned, state: l.state }));

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex gap-3 text-sm">
          <a href={`/coach/athletes/${athlete.id}`} className="text-accent">← {name}</a>
          <a href="/coach/report" className="text-muted hover:text-foreground">· {d.changeFilter}</a>
        </div>
        <PrintButton label={d.print} />
      </div>

      <header>
        <h1 className="text-2xl font-bold">{d.title}: {name}</h1>
        <p className="text-sm text-muted">
          {range.from} → {range.to} · {d.coverage
            .replace("{filled}", String(stats.filled))
            .replace("{expected}", String(stats.expected))
            .replace("{pct}", String(stats.rate))}
        </p>
      </header>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-2 font-semibold">{d.wellness}</h2>
        <p className="text-sm">
          {d.avgReadiness}: <b>{stats.avgReadiness ?? "—"}</b>
          {norm ? <span className="text-muted"> (норма {Math.round(norm.avg)})</span> : null}
          {" · "}{d.avgSleep}: <b>{stats.avgSleep ?? "—"}/5</b>
          {" · "}{d.avgFatigue}: <b>{stats.avgFatigue ?? "—"}/5</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          {belowNorm === null ? d.noNorm : d.belowNorm.replace("{n}", String(belowNorm))}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <div>
          <h2 className="font-semibold">{d.load}</h2>
          <p className="text-xs text-muted">AU — {d.auExplain}</p>
        </div>
        <p className="text-sm">
          {d.factVsPlan}: <b>{totalAU}</b> / {plannedAU || "—"} AU
          {planPct != null ? <span> ({planPct}%)</span> : null}
          {" · "}{d.sessions}: <b>{stats.sessions}</b>
          {" · "}{d.overPlan}: <b>{overPlan}</b>
        </p>
        <p className="text-xs text-muted">
          {d.avgSession}: {avgSessionAU} AU · {d.avgRpe}: {avgRpe} · {d.avgMin}: {avgMin}
          {" · "}
          {coverage.reliable
            ? d.loadCoverage.replace("{pct}", String(coverage.pct))
            : d.loadUnreliable.replace("{pct}", String(coverage.pct))}
        </p>
        <div className="print:hidden">
          <LoadBarChart
            data={chartData}
            height={170}
            label={dict.dashboard.fact}
            plannedLabel={dict.dashboard.plan}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-2 font-semibold">{d.attendance}</h2>
        <p className="text-sm">
          {d.scheduledDays}: <b>{att.scheduled}</b>
          {" · "}{d.present}: <b>{att.attended}</b>
          {" · "}{d.absent}: <b>{att.absent}</b>
          {" · "}{d.excused}: <b>{att.excused}</b>
          {att.rate != null ? <> · {d.attRate}: <b>{att.rate}%</b></> : null}
        </p>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-2 font-semibold">{d.pain}</h2>
        {pains.length === 0 ? (
          <p className="text-sm text-muted">{d.noPain}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pains.map((p) => (
              <li key={p.id}>
                {p.report_date} — {zoneOf(p.zone)}
                {p.side && p.side !== "na" ? ` (${p.side})` : ""}
                {p.severity ? ` · ${d.severity} ${p.severity}/10` : ""}
                {p.onset === "new" ? ` · ${d.newPain}` : p.onset === "same" ? ` · ${d.samePain}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

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
