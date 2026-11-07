import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { dateRange, localDate, resolveRange, todayInTz, type RangeKey } from "@/lib/dates";
import { athleteStats } from "@/lib/analytics";
import { dailyReadiness, postsByLocalDate, personalNorm } from "@/lib/readiness";
import { dailyLoads, loadCoverage } from "@/lib/load";
import { PrintButton } from "./print-button";
import type { PlanOverride } from "@/lib/load";
import type {
  Alert, Athlete, MorningCheckin, PainReport, PostTrainingCheckin,
  Profile, TrainingSchedule, TrainingSession, GroupMembership,
} from "@/lib/types";

/** Compact per-athlete report for a period — designed to print to PDF. */
export default async function CoachReportPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string; period?: string; from?: string; to?: string }>;
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
  const athlete = ((athletes as Athlete[]) ?? []).find((a) => a.id === sp.athlete);
  if (!athlete) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-muted">{d.noAthlete}</p>
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
      supabase.from("attendance").select("*").eq("athlete_id", athlete.id)
        .gte("date", range.from).lte("date", range.to),
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
  const myOverrides = ((ovRes.data as PlanOverride[]) ?? []).filter(
    (o) => (o as { group_id?: string }).group_id === membership?.group_id,
  );
  const attendance = (attRes.data as { date: string; status: string }[]) ?? [];

  const stats = athleteStats(athlete.id, days, checkins, sessions, alerts, postsByLocalDate(posts, aTz), aTz);
  const sessionInputs = sessions.map((s) => ({
    date: localDate(new Date(s.started_at), aTz),
    rpe: s.session_rpe,
    minutes: s.duration_minutes,
  }));
  const attendanceMarks = {
    present: new Set(attendance.filter((a) => a.status === "present").map((a) => a.date)),
    absent: new Set(attendance.filter((a) => a.status !== "present").map((a) => a.date)),
  };
  const loads = dailyLoads(days, sessionInputs, mySchedules, myOverrides, attendanceMarks);
  const coverage = loadCoverage(loads);
  const overPlan = loads.filter((l) => l.state === "known" && l.planned != null && l.load > l.planned * 1.25).length;
  const totalAU = loads.reduce((a, l) => a + (l.state === "known" ? l.load : 0), 0);
  const series = dailyReadiness(checkins);
  const norm = personalNorm(series, range.to);
  const belowNorm = norm ? series.filter((s) => s.score < norm.avg - norm.sd).length : null;

  const present = attendance.filter((a) => a.status === "present").length;
  const absent = attendance.filter((a) => a.status === "absent").length;
  const excused = attendance.filter((a) => a.status === "excused").length;

  const zoneOf = (z: string) => (dict.pro.bodyZones as Record<string, string>)[z] ?? z;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <a href={`/coach/athletes/${athlete.id}`} className="text-sm text-accent">← {name}</a>
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
          {" · "}{d.avgSleep}: {stats.avgSleep ?? "—"}
          {" · "}{d.avgFatigue}: {stats.avgFatigue ?? "—"}
        </p>
        <p className="mt-1 text-xs text-muted">
          {belowNorm === null ? d.noNorm : d.belowNorm.replace("{n}", String(belowNorm))}
        </p>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-2 font-semibold">{d.load}</h2>
        <p className="text-sm">
          {d.sessions}: <b>{stats.sessions}</b> · {d.totalAU}: <b>{totalAU}</b>
          {" · "}{d.overPlan}: <b>{overPlan}</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          {coverage.reliable
            ? d.loadCoverage.replace("{pct}", String(coverage.pct))
            : d.loadUnreliable.replace("{pct}", String(coverage.pct))}
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
        <h2 className="mb-2 font-semibold">{d.attendance}</h2>
        <p className="text-sm">
          {d.present}: <b>{present}</b> · {d.absent}: <b>{absent}</b> · {d.excused}: <b>{excused}</b>
        </p>
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
