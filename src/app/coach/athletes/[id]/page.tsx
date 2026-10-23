import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, dateRange, localDate, resolveRange, todayInTz, type RangeKey } from "@/lib/dates";
import { dailyReadiness } from "@/lib/readiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart, LoadBarChart } from "@/components/charts/series-chart";
import { CoachNotes } from "./notes";
import { AlertList } from "./alert-list";
import { cn } from "@/lib/utils";
import type {
  Alert,
  Athlete,
  CoachNote,
  MorningCheckin,
  PostTrainingCheckin,
  Profile,
  ReadinessSnapshot,
  TrainingSession,
} from "@/lib/types";

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function AthleteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const dd = dict.athleteDetail;
  const supabase = await createClient();

  // RLS: returns null unless this athlete is assigned to the coach.
  const { data: athlete } = await supabase.from("athletes").select("*").eq("id", id).maybeSingle();
  if (!athlete) notFound();
  const a = athlete as Athlete;

  const [{ data: aProfile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", a.profile_id).maybeSingle(),
    supabase
      .from("group_memberships")
      .select("group_id, group:groups(name)")
      .eq("athlete_id", a.id)
      .is("left_at", null)
      .maybeSingle(),
  ]);
  const tz = ((aProfile as Profile | null)?.timezone) ?? me.timezone;
  const today = todayInTz(tz);
  const groupName = (membership as { group?: { name: string } } | null)?.group?.name ?? "—";

  const range = resolveRange((sp.range as RangeKey) || "30d", tz, { from: sp.from, to: sp.to });

  const [{ data: checkins }, { data: sessions }, { data: postCheckins }, { data: snapshots }, { data: alerts }, { data: notes }, { data: consents }] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", a.id).gte("checkin_date", addDays(range.from, -30)).order("checkin_date"),
      supabase.from("training_sessions").select("*").eq("athlete_id", a.id).gte("started_at", `${addDays(range.from, -14)}T00:00:00Z`).order("started_at"),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", a.id).gte("submitted_at", `${addDays(range.from, -14)}T00:00:00Z`),
      supabase.from("readiness_snapshots").select("*").eq("athlete_id", a.id).order("snapshot_date", { ascending: false }).limit(1),
      supabase.from("alerts").select("*").eq("athlete_id", a.id).order("triggered_at", { ascending: false }).limit(50),
      supabase.from("coach_notes").select("*").eq("athlete_id", a.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("consent_records").select("*").eq("athlete_id", a.id).order("recorded_at", { ascending: false }),
    ]);

  const ck = ((checkins as MorningCheckin[]) ?? []).filter(
    (c) => c.checkin_date >= addDays(range.from, -30) && c.checkin_date <= range.to,
  );
  const inRange = ck.filter((c) => c.checkin_date >= range.from);
  const ss = ((sessions as TrainingSession[]) ?? []).filter(
    (s) => localDate(new Date(s.started_at), tz) <= range.to,
  );
  const ssInRange = ss.filter((s) => localDate(new Date(s.started_at), tz) >= range.from);

  const latestSnap = (snapshots as ReadinessSnapshot[] | null)?.[0] ?? null;
  const series = dailyReadiness(ck.filter((c) => c.checkin_date <= range.to));
  const inRangeSeries = series.filter((p) => p.date >= range.from);

  const wellbeing = inRange.map((c) => ({
    date: c.checkin_date,
    sleep: c.sleep_score,
    fatigue: c.fatigue_score,
    soreness: c.muscle_soreness_score,
  }));
  const loads = ssInRange.map((s) => ({
    date: localDate(new Date(s.started_at), tz),
    load: s.session_load,
    rpe: s.session_rpe,
  }));

  const scores = inRangeSeries.map((p) => p.score);
  const stat = {
    avg: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null,
    median: median(scores),
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
    count: inRange.length,
    totalLoad: ssInRange.reduce((x, s) => x + s.session_load, 0),
    sessions: ssInRange.length,
    minutes: ssInRange.reduce((x, s) => x + s.duration_minutes, 0),
  };

  // Calendar: every day in range; filled check-in vs missed.
  const filledDates = new Set(ck.map((c) => c.checkin_date));
  const calDays = dateRange(range.from, range.to).slice(-35);

  const painEntries = [
    ...ck.filter((c) => c.pain_status !== "none").map((c) => ({
      date: c.checkin_date,
      status: c.pain_status,
      location: c.pain_location,
      src: dict.nav.morning,
    })),
    ...((postCheckins as PostTrainingCheckin[]) ?? [])
      .filter((p) => p.pain_status !== "none")
      .map((p) => ({
        date: localDate(new Date(p.submitted_at), tz),
        status: p.pain_status,
        location: p.pain_location,
        src: dict.nav.training,
      })),
  ].sort((x, y) => y.date.localeCompare(x.date));

  const rangeKeys: RangeKey[] = ["7d", "14d", "30d", "90d", "month", "prev_month"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            {(aProfile as Profile | null)?.display_name ?? a.athlete_code}
          </h1>
          <p className="text-sm text-muted">
            {a.athlete_code} · {dict.common.group}: {groupName}
            {a.birth_year ? ` · ${new Date().getUTCFullYear() - a.birth_year}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {rangeKeys.map((k) => (
            <a
              key={k}
              href={`/coach/athletes/${a.id}?range=${k}`}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs",
                (sp.range ?? "30d") === k ? "bg-accent text-white" : "bg-foreground/5",
              )}
            >
              {dict.ranges[k]}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          [dict.stats.avg, stat.avg],
          [dict.stats.median, stat.median],
          [dict.stats.min, stat.min],
          [dict.stats.max, stat.max],
          [dict.stats.count, stat.count],
          [dict.stats.sessions, stat.sessions],
          [dict.stats.totalLoad, stat.totalLoad],
        ].map(([label, v]) => (
          <Card key={label as string}>
            <CardContent className="pt-3 pb-3">
              <p className="text-lg font-bold">{v ?? "—"}</p>
              <p className="text-xs text-muted">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {latestSnap && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-4">
            <div>
              <p className="text-xs text-muted">{dd.baseline}</p>
              <p className="font-semibold">
                {latestSnap.baseline_avg !== null
                  ? `${Math.round(latestSnap.baseline_avg)} ± ${Math.round(latestSnap.baseline_sd ?? 0)}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{dd.currentVsBaseline}</p>
              <p className="font-semibold">
                {latestSnap.readiness_score !== null ? Math.round(Number(latestSnap.readiness_score)) : "—"}
              </p>
            </div>
            <Badge tone={latestSnap.confidence === "sufficient" ? "ok" : "warn"}>
              {latestSnap.input_data_count} {dd.observations} ·{" "}
              {latestSnap.confidence === "sufficient" ? "OK" : dict.common.insufficientData}
            </Badge>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{dd.calendar}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1">
            {calDays.map((day) => (
              <span
                key={day}
                title={day}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded text-[10px]",
                  filledDates.has(day)
                    ? "bg-ok/15 text-ok"
                    : day < today
                      ? "bg-danger/10 text-danger"
                      : "bg-foreground/5 text-muted",
                )}
              >
                {day.slice(8)}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{dict.history.readiness}</CardTitle>
          </CardHeader>
          <CardContent>
            {inRangeSeries.length === 0 ? (
              <p className="text-sm text-muted">{dict.common.noData}</p>
            ) : (
              <SeriesLineChart
                data={inRangeSeries}
                series={[{ key: "score", label: dict.history.readiness, color: "#2563eb" }]}
                domain={[0, 100]}
                reference={latestSnap?.baseline_avg != null ? { y: Number(latestSnap.baseline_avg) } : undefined}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              {dict.history.sleep} · {dict.history.fatigue} · {dict.history.soreness}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {wellbeing.length === 0 ? (
              <p className="text-sm text-muted">{dict.common.noData}</p>
            ) : (
              <SeriesLineChart
                data={wellbeing}
                series={[
                  { key: "sleep", label: dict.history.sleep, color: "#2563eb" },
                  { key: "fatigue", label: dict.history.fatigue, color: "#d97706" },
                  { key: "soreness", label: dict.history.soreness, color: "#dc2626" },
                ]}
                domain={[1, 5]}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{dict.history.weeklyLoad}</CardTitle>
        </CardHeader>
        <CardContent>
          {loads.length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <LoadBarChart data={loads} label={dict.history.load} />
          )}
        </CardContent>
      </Card>

      <AlertList alerts={(alerts as Alert[]) ?? []} dict={dict} />

      <Card>
        <CardHeader>
          <CardTitle>{dd.painHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {painEntries.length === 0 ? (
            <p className="text-sm text-muted">{dict.history.noPain}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {painEntries.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span>
                    {p.date} · {p.src}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    {p.location ?? p.status}
                    {p.status === "acute_instability" && <Badge tone="danger">!</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CoachNotes
        athleteId={a.id}
        notes={(notes as CoachNote[]) ?? []}
        dict={dict}
      />

      {(consents ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{dd.consent}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm">
              {(consents as { id: string; consent_type: string; status: string; recorded_at: string }[]).map((c) => (
                <li key={c.id} className="flex justify-between py-1">
                  <span>{c.consent_type}</span>
                  <Badge tone={c.status === "granted" ? "ok" : c.status === "revoked" ? "danger" : "warn"}>
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
