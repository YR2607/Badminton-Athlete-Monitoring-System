import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, dateRange, localDate, resolveRange, todayInTz, type RangeKey } from "@/lib/dates";
import { conditionScore, dailyConditionSeries, postsByLocalDate } from "@/lib/readiness";
import { pendingPostCheckins } from "@/lib/athlete-status";
import { allAthleteIds } from "@/lib/coach-data";
import { AthleteSwitcher, type NavAthlete } from "./athlete-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart } from "@/components/charts/series-chart";
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

  // Athletes the viewer can jump between in the profile switcher.
  const navIds = me.role === "coach" ? await allAthleteIds(supabase) : null;
  let navQuery = supabase.from("athletes").select("id, athlete_code, profile_id");
  if (navIds) navQuery = navQuery.in("id", navIds.length ? navIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: navRows } = await navQuery;
  const navProfileIds = ((navRows as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? []).map(
    (x) => x.profile_id,
  );
  const { data: navProfiles } = navProfileIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", navProfileIds)
    : { data: [] as { id: string; display_name: string }[] };
  const navNameById = new Map((navProfiles ?? []).map((p) => [p.id, p.display_name]));
  const navAthletes: NavAthlete[] = (
    (navRows as Pick<Athlete, "id" | "athlete_code" | "profile_id">[]) ?? []
  )
    .map((x) => ({ id: x.id, name: navNameById.get(x.profile_id) ?? x.athlete_code }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const [{ data: checkins }, { data: sessions }, { data: postCheckins }, { data: todayCheckin }, { data: recentSessions }, { data: recentPosts }, { data: snapshots }, { data: alerts }, { data: notes }, { data: consents }] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", a.id).gte("checkin_date", addDays(range.from, -30)).order("checkin_date"),
      supabase.from("training_sessions").select("*").eq("athlete_id", a.id).gte("started_at", `${addDays(range.from, -14)}T00:00:00Z`).order("started_at"),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", a.id).gte("submitted_at", `${addDays(range.from, -30)}T00:00:00Z`),
      // "Today" block is independent of the selected range — its own window.
      supabase.from("morning_checkins").select("*").eq("athlete_id", a.id).eq("checkin_date", today).maybeSingle(),
      supabase.from("training_sessions").select("*").eq("athlete_id", a.id).gte("started_at", `${addDays(today, -14)}T00:00:00Z`),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", a.id).gte("submitted_at", `${addDays(today, -14)}T00:00:00Z`),
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
  const series = dailyConditionSeries(
    ck.filter((c) => c.checkin_date <= range.to),
    postsByLocalDate(
      ((postCheckins as PostTrainingCheckin[]) ?? []).filter(
        (p) => localDate(new Date(p.submitted_at), tz) <= range.to,
      ),
      tz,
    ),
  );
  const inRangeSeries = series.filter((p) => p.date >= range.from);

  const wellbeing = inRange.map((c) => ({
    date: c.checkin_date,
    sleep: c.sleep_score,
    fatigue: c.fatigue_score,
    soreness: c.muscle_soreness_score,
  }));
  const scores = inRangeSeries.map((p) => p.score);
  const stat = {
    avg: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null,
    median: median(scores),
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
    count: inRange.length,
    sessions: ssInRange.length,
  };

  // Calendar: every day in range; filled check-in vs missed.
  const filledDates = new Set(ck.map((c) => c.checkin_date));
  const calDays = dateRange(range.from, range.to).slice(-35);

  // ---- "Today" block: independent of the selected range ----
  const tCheckin = (todayCheckin as MorningCheckin | null) ?? null;
  const recentSs = (recentSessions as TrainingSession[]) ?? [];
  const recentPs = (recentPosts as PostTrainingCheckin[]) ?? [];
  const todayPost = postsByLocalDate(recentPs, tz).find((e) => e.date === today)?.post ?? null;
  const todayScore = tCheckin ? conditionScore(tCheckin, todayPost) : null;
  const lastTodayCheckin =
    [((checkins as MorningCheckin[]) ?? [])].flat()
      .filter((c) => c.checkin_date <= today)
      .sort((x, y) => y.checkin_date.localeCompare(x.checkin_date))[0] ?? tCheckin;
  const openAlerts = ((alerts as Alert[]) ?? []).filter((x) => x.status === "open");
  const sessionsTodayCount = recentSs.filter(
    (s) => localDate(new Date(s.started_at), tz) === today,
  ).length;
  const pendingPosts = pendingPostCheckins(recentSs, recentPs, new Date());
  const normObs = latestSnap?.input_data_count ?? ck.length;
  const normAvg = latestSnap?.baseline_avg ?? null;
  const normReady = latestSnap?.confidence === "sufficient" && normAvg !== null;
  const normDelta =
    todayScore !== null && normAvg !== null
      ? Math.round((todayScore - Number(normAvg)) * 10) / 10
      : null;

  const compMeta: { key: keyof MorningCheckin; label: string; hint: string; inverted: boolean }[] = [
    { key: "sleep_score", label: dict.history.sleep, hint: dd.today.hints.sleep, inverted: false },
    { key: "recovery_score", label: dict.history.recovery, hint: dd.today.hints.recovery, inverted: false },
    { key: "fatigue_score", label: dict.history.fatigue, hint: dd.today.hints.fatigue, inverted: true },
    { key: "muscle_soreness_score", label: dict.history.soreness, hint: dd.today.hints.soreness, inverted: true },
    { key: "stress_score", label: dict.history.stress, hint: dd.today.hints.stress, inverted: true },
    { key: "mood_score", label: dict.history.mood, hint: dd.today.hints.mood, inverted: false },
  ];

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
        {navAthletes.length > 1 && (
          <AthleteSwitcher athletes={navAthletes} currentId={a.id} label={dd.profile} />
        )}
      </div>

      {/* Today block — independent of the selected period below */}
      <Card>
        <CardHeader>
          <CardTitle>{dd.today.title} · {today}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-xs text-muted">{dd.today.morningScore}</p>
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums leading-tight",
                  todayScore === null
                    ? "text-muted"
                    : todayScore >= 70
                      ? "text-ok"
                      : todayScore >= 45
                        ? "text-warn"
                        : "text-danger",
                )}
              >
                {todayScore !== null ? Math.round(todayScore) : "—"}
              </p>
              {normDelta !== null && (
                <p className="text-[11px] text-muted">
                  {normDelta > 0 ? "▲" : "▼"} {Math.abs(normDelta)} {dd.today.vsNorm}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted">{dd.today.lastData}</p>
              <p className="font-medium">
                {lastTodayCheckin?.checkin_date ?? latestSnap?.snapshot_date ?? dict.common.noData}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{dd.today.observations}</p>
              <p className="font-medium">
                {normObs}
                {!normReady && (
                  <span className="ml-1 text-xs text-muted">— {dd.today.normInsufficient}</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{dd.today.trainings}</p>
              <p className="font-medium">
                {sessionsTodayCount} {dd.today.sessionsCount}
                {pendingPosts.length > 0 && (
                  <Badge tone="warn" className="ml-2">
                    {dd.today.postPending}: {pendingPosts.length}
                  </Badge>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{dd.today.signals}</p>
              <div className="flex flex-wrap gap-1">
                {openAlerts.length === 0 ? (
                  <span className="text-sm text-muted">{dd.today.noSignals}</span>
                ) : (
                  openAlerts.map((al) => (
                    <Badge
                      key={al.id}
                      tone={
                        al.severity === "priority"
                          ? "danger"
                          : al.severity === "review_load"
                            ? "warn"
                            : "accent"
                      }
                      title={al.recommendation}
                    >
                      {dict.alerts.severity[al.severity as keyof typeof dict.alerts.severity] ??
                        al.severity}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </div>

          {!tCheckin && <p className="text-sm text-muted">{dd.today.noCheckin}</p>}

          {/* Pain / red flags live outside the composite score */}
          {tCheckin && tCheckin.pain_status !== "none" && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {dict.history.painHistory}: {tCheckin.pain_location ?? tCheckin.pain_status}
              {tCheckin.swelling ? ` · ${dd.today.swelling}` : ""}
              {tCheckin.movement_limitation ? ` · ${dd.today.limitation}` : ""}
              {tCheckin.pain_severity ? ` · ${tCheckin.pain_severity}/10` : ""}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {compMeta.map((c) => {
              const v = tCheckin ? (tCheckin[c.key] as number | null) : null;
              const goodness = v === null ? null : c.inverted ? 6 - v : v;
              return (
                <div
                  key={c.key}
                  title={`${c.hint} · ${c.inverted ? dd.today.lowerBetter : dd.today.higherBetter}`}
                  className="rounded-lg border border-border/60 p-2"
                >
                  <p className="truncate text-[11px] text-muted" title={c.label}>
                    {c.label}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">
                    {v !== null ? `${v}/5` : dict.common.noData}
                  </p>
                  <div className="mt-1 h-1.5 rounded bg-foreground/10">
                    {goodness !== null && (
                      <div
                        className={cn(
                          "h-1.5 rounded",
                          goodness >= 4 ? "bg-ok" : goodness >= 3 ? "bg-warn" : "bg-danger",
                        )}
                        style={{ width: `${(goodness / 5) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: dict.stats.avg, v: stat.avg, sub: dict.stats.of100, tone: true },
          { label: dict.stats.median, v: stat.median, sub: dict.stats.medianHint, tone: true },
          { label: dict.stats.min, v: stat.min, sub: dict.stats.of100, tone: true },
          { label: dict.stats.max, v: stat.max, sub: dict.stats.of100, tone: true },
          { label: dict.stats.count, v: stat.count },
          { label: dict.stats.sessions, v: stat.sessions },
        ].map(({ label, v, sub, tone }) => (
          <Card key={label}>
            <CardContent className="pt-3 pb-3">
              <p
                className={cn(
                  "text-lg font-bold",
                  tone && v !== null && (v >= 70 ? "text-ok" : v >= 45 ? "text-warn" : "text-danger"),
                )}
              >
                {v ?? "—"}
              </p>
              <p className="text-xs text-muted">{label}</p>
              {sub && <p className="text-[10px] text-muted/70">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">{dict.stats.explainer}</p>

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
              <Link
                key={day}
                href={`/coach/athletes/${a.id}/day/${day}`}
                title={day}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded text-[10px]",
                  filledDates.has(day)
                    ? "bg-ok/15 text-ok"
                    : day < today
                      ? "bg-danger/10 text-danger"
                      : "bg-foreground/5 text-muted",
                )}
              >
                {day.slice(8)}
              </Link>
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
