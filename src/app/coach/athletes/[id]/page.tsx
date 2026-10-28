import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, dateRange, localDate, type RangeKey } from "@/lib/dates";
import { conditionScore, dailyConditionSeries, postsByLocalDate } from "@/lib/readiness";
import { dayStatuses, sessionDateByIdMap } from "@/lib/checkins";
import { ageInDays, pendingPostCheckins } from "@/lib/athlete-status";
import { avatarPublicUrl, getAvatarPreset } from "@/lib/avatars";
import { getAthleteDetail } from "@/lib/athlete-detail";
import { AthleteDashboard } from "@/components/dashboard/athlete-dashboard";
import { RecList } from "./rec-list";
import { GrowthPanel } from "./growth-panel";
import { EventsPanel } from "@/components/events-panel";
import { OstrcHeatmap } from "@/components/ostrc-heatmap";
import { TestsPanel } from "./tests-panel";
import { FieldTestRadar } from "@/components/athlete-radar-badges";
import { decimalAge, growthVelocity, khamisRoche, maturationCategory } from "@/lib/growth";
import { AthleteSwitcher } from "./athlete-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart } from "@/components/charts/series-chart";
import { CoachNotes } from "./notes";
import { AlertList } from "./alert-list";
import { cn } from "@/lib/utils";
import type {
  Alert,
  CoachNote,
  MorningCheckin,
  PostTrainingCheckin,
  Profile,
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

  // RLS: null unless this athlete is assigned to the coach.
  const data = await getAthleteDetail(supabase, id, {
    role: me.role,
    timezone: me.timezone,
    range: sp.range,
    from: sp.from,
    to: sp.to,
  });
  if (!data) notFound();
  const {
    a,
    aProfile,
    membership,
    groupName,
    tz,
    today,
    range,
    navAthletes,
    dashboardOn,
    srpeOn,
    zscoreOn,
    recsOn,
    eventsOn,
    ostrcOn,
    testsOn,
    growthOn,
    checkins,
    sessions,
    postCheckins,
    todayCheckin,
    recentSessions,
    recentPosts,
    latestSnap,
    alerts,
    notes,
    consents,
    recs,
    eventRows,
    ostrcZones,
    ostrcRows,
    fieldTests,
    testResults,
    groupMedian,
    growthMs,
    dashSnaps,
    dashLoads,
    attendanceStats,
  } = data;

  const ck = ((checkins as MorningCheckin[]) ?? []).filter(
    (c) => c.checkin_date >= addDays(range.from, -30) && c.checkin_date <= range.to,
  );
  const inRange = ck.filter((c) => c.checkin_date >= range.from);
  const ss = ((sessions as TrainingSession[]) ?? []).filter(
    (s) => localDate(new Date(s.started_at), tz) <= range.to,
  );
  const ssInRange = ss.filter((s) => localDate(new Date(s.started_at), tz) >= range.from);

  const sessionDateById = sessionDateByIdMap((sessions as TrainingSession[]) ?? [], tz);
  const rangePostEntries = postsByLocalDate(
    ((postCheckins as PostTrainingCheckin[]) ?? []).filter(
      (p) => (sessionDateById.get(p.training_session_id) ?? localDate(new Date(p.submitted_at), tz)) <= range.to,
    ),
    tz,
    sessionDateById,
  );
  const series = dailyConditionSeries(
    ck.filter((c) => c.checkin_date <= range.to),
    rangePostEntries,
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

  // Calendar: every day in range; morning + evening check-in dots per day.
  const calDays = dateRange(range.from, range.to).slice(-35);
  const calStatus = new Map(
    dayStatuses({
      days: calDays,
      checkins: ck,
      postEntries: rangePostEntries,
      sessions: ss,
      tz,
    }).map((s) => [s.date, s]),
  );

  // ---- "Today" block: independent of the selected range ----
  const tCheckin = (todayCheckin as MorningCheckin | null) ?? null;
  const recentSs = (recentSessions as TrainingSession[]) ?? [];
  const recentPs = (recentPosts as PostTrainingCheckin[]) ?? [];
  const recentSessionDateById = sessionDateByIdMap(recentSs, tz);
  const todayPost = postsByLocalDate(recentPs, tz, recentSessionDateById).find((e) => e.date === today)?.post ?? null;
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

  const gLast = growthMs.at(-1) ?? null;
  const gVelocity = growthVelocity(
    growthMs.map((g) => ({ measured_on: g.measured_on, height_cm: g.height_cm, weight_kg: g.weight_kg })),
  );
  const kr =
    growthOn && a.birth_date && a.sex && gLast &&
    a.mother_height_cm != null && a.father_height_cm != null && gLast.weight_kg != null
      ? khamisRoche(
          a.sex,
          gLast.height_cm,
          gLast.weight_kg,
          a.mother_height_cm,
          a.father_height_cm,
          decimalAge(a.birth_date, today),
        )
      : null;

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

      {/* Light athlete card: photo, game profile, goal, equipment, attendance. */}
      {(a.photo_path ||
        a.preferred_discipline ||
        a.play_style ||
        a.season_goal ||
        a.racket_model ||
        (attendanceStats && attendanceStats.scheduled > 0)) && (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-4 pt-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-foreground/5 text-2xl"
              title={getAvatarPreset(a.photo_path)?.title[me.preferred_language] ?? undefined}
            >
              {a.photo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPublicUrl(a.photo_path)}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                "🏸"
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {getAvatarPreset(a.photo_path) && (
                  <Badge tone="neutral" title={getAvatarPreset(a.photo_path)!.subtitle[me.preferred_language]}>
                    {getAvatarPreset(a.photo_path)!.emoji}{" "}
                    {getAvatarPreset(a.photo_path)!.title[me.preferred_language]}
                  </Badge>
                )}
                {a.preferred_discipline && (
                  <Badge tone="accent">🏸 {a.preferred_discipline}</Badge>
                )}
                {a.play_style && (
                  <Badge tone="neutral">
                    {dict.card[
                      { attacking: "styleAttacking", defensive: "styleDefensive", net: "styleNet", allround: "styleAllround" }[
                        a.play_style
                      ] as "styleAttacking"
                    ]}
                  </Badge>
                )}
                {a.racket_hand && (
                  <Badge tone="neutral">
                    {a.racket_hand === "left" ? dict.pro.leftHand : dict.pro.rightHand}
                  </Badge>
                )}
              </div>
              {a.season_goal && (
                <p className="text-muted">
                  🎯 {dict.card.goalLabel}:{" "}
                  <span className="text-foreground">{a.season_goal}</span>
                </p>
              )}
              {(a.racket_model || a.string_tension_kg || a.restrung_on) && (
                <p className="text-muted">
                  🏸 {[a.racket_model, a.string_tension_kg ? `${a.string_tension_kg} kg` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  {a.restrung_on && ` · ${dict.card.restrungOn}: ${a.restrung_on}`}
                  {a.restrung_on && ageInDays(a.restrung_on, today) > 75 && (
                    <Badge tone="warn" className="ml-1">
                      ⚠ {dict.card.restrungOld.replace("{d}", String(Math.floor(ageInDays(a.restrung_on, today) / 30)))}
                    </Badge>
                  )}
                </p>
              )}
            </div>
            {attendanceStats && attendanceStats.scheduled > 0 && (
              <div
                className="rounded-xl border border-border/60 px-3 py-2 text-sm"
                title={dict.attendance.hint}
              >
                <p className="text-xs text-muted">{dict.attendance.stat30}</p>
                <p className="mt-0.5 font-bold tabular-nums">
                  {attendanceStats.attended}/{attendanceStats.scheduled}
                  <span
                    className={cn(
                      "ml-1.5",
                      (attendanceStats.rate ?? 0) >= 85
                        ? "text-ok"
                        : (attendanceStats.rate ?? 0) >= 65
                          ? "text-warn"
                          : "text-danger",
                    )}
                  >
                    {attendanceStats.rate}%
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {[
                    attendanceStats.absent > 0
                      ? dict.attendance.absentCount.replace("{n}", String(attendanceStats.absent))
                      : null,
                    attendanceStats.excused > 0
                      ? dict.attendance.excusedCount.replace("{n}", String(attendanceStats.excused))
                      : null,
                    attendanceStats.unmarked > 0
                      ? dict.attendance.unmarkedCount.replace("{n}", String(attendanceStats.unmarked))
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                title={dict.common.readinessHint}
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
              const goodness = v === null ? null : c.inverted ? 11 - v : v;
              return (
                <div
                  key={c.key}
                  title={`${c.hint} · ${c.inverted ? dd.today.lowerBetter : dd.today.higherBetter}`}
                  className="rounded-lg border border-border/60 p-2"
                >
                  <p className="truncate text-[11px] text-muted" title={c.label}>
                    {c.label}
                  </p>
                  <p className="flex items-baseline justify-between gap-1 text-sm font-semibold tabular-nums">
                    <span>{v !== null ? `${v}/10` : dict.common.noData}</span>
                    <span className="text-[10px] font-normal text-muted">
                      {c.inverted ? "↓" : "↑"}
                    </span>
                  </p>
                  <div className="mt-1 h-1.5 rounded bg-foreground/10">
                    {goodness !== null && (
                      <div
                        className={cn(
                          "h-1.5 rounded",
                          goodness >= 7 ? "bg-ok" : goodness >= 4 ? "bg-warn" : "bg-danger",
                        )}
                        style={{ width: `${(goodness / 10) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {dashboardOn && (srpeOn || zscoreOn) && (
        <AthleteDashboard
          dict={dict}
          snapshots={dashSnaps}
          loads={dashLoads}
          srpe={srpeOn}
          zscore={zscoreOn}
          events={eventsOn ? eventRows : []}
        />
      )}

      {recsOn && <RecList recs={recs} dict={dict} />}

      {eventsOn && (
        <EventsPanel
          dict={dict}
          events={eventRows}
          athleteId={a.id}
          groupId={membership?.group_id ?? null}
          mode="staff"
        />
      )}

      {ostrcOn && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.ostrc.historyTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {ostrcRows.length === 0 ? (
              <p className="text-sm text-muted">{dict.common.noData}</p>
            ) : (
              <OstrcHeatmap
                dict={dict}
                lang={me.preferred_language}
                zones={ostrcZones}
                responses={ostrcRows}
              />
            )}
          </CardContent>
        </Card>
      )}

      {testsOn && fieldTests.length > 0 && (
        <>
          <FieldTestRadar
            dict={dict}
            lang={me.preferred_language}
            tests={fieldTests}
            ownResults={testResults}
            groupMedian={groupMedian}
          />
          <TestsPanel
            dict={dict}
            lang={me.preferred_language}
            athleteId={a.id}
            tests={fieldTests}
            results={testResults}
            groupMedian={groupMedian}
          />
        </>
      )}

      {growthOn && (
        <GrowthPanel
          dict={dict}
          athlete={a}
          measurements={growthMs}
          velocity={gVelocity}
          pahCm={kr?.pahCm ?? null}
          pctPah={kr?.pctPah ?? null}
          category={kr ? maturationCategory(kr.pctPah) : null}
        />
      )}

      <div className="flex flex-wrap gap-1">
          {rangeKeys.map((k) => (
            <a
              key={k}
              href={`/coach/athletes/${a.id}?range=${k}`}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs",
                (sp.range ?? "30d") === k ? "bg-accent text-accent-foreground" : "bg-foreground/5",
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
            <div title={dict.coach.tipBaseline}>
              <p className="text-xs text-muted">{dd.baseline}</p>
              <p className="font-semibold">
                {latestSnap.baseline_avg !== null
                  ? `${Math.round(latestSnap.baseline_avg)} ± ${Math.round(latestSnap.baseline_sd ?? 0)}`
                  : "—"}
              </p>
            </div>
            <div title={dict.coach.tipVsNorm}>
              <p className="text-xs text-muted">{dd.currentVsBaseline}</p>
              <p className="font-semibold">
                {latestSnap.readiness_score !== null ? Math.round(Number(latestSnap.readiness_score)) : "—"}
              </p>
            </div>
            <Badge
              tone={latestSnap.confidence === "sufficient" ? "ok" : "warn"}
              title={dict.coach.tipObs}
            >
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
            {calDays.map((day) => {
              const st = calStatus.get(day);
              const morning = st?.morning != null;
              const pain = st?.hasPain === true;
              const evening = st?.evening != null;
              const hadSession = st?.hadSession === true;
              return (
                <Link
                  key={day}
                  href={`/coach/athletes/${a.id}/day/${day}`}
                  title={day}
                  className={cn(
                    "flex h-9 w-8 flex-col items-center justify-center rounded text-[10px] transition-shadow hover:ring-1 hover:ring-accent/50",
                    morning
                      ? "bg-ok/15 text-ok"
                      : day < today
                        ? "bg-danger/10 text-danger"
                        : "bg-foreground/5 text-muted",
                  )}
                >
                  <span>{day.slice(8)}</span>
                  <span className="mt-0.5 flex gap-1">
                    <span
                      title={`${day} · ${dict.analytics.dotMorning}`}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        pain
                          ? "bg-danger"
                          : morning
                            ? "bg-ok"
                            : day <= today
                              ? "bg-danger/40"
                              : "bg-foreground/15",
                      )}
                    />
                    <span
                      title={`${day} · ${dict.analytics.dotEvening}`}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        evening
                          ? "bg-accent"
                          : hadSession
                            ? "bg-warn/70"
                            : "bg-foreground/15",
                      )}
                    />
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ok" /> {dict.analytics.dotMorning}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" /> {dict.analytics.dotEvening}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn/70" /> {dict.analytics.dotNoSession}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> {dict.analytics.painDay}</span>
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
                series={[{ key: "score", label: dict.history.readiness, color: "var(--accent)", fill: true }]}
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
                  { key: "sleep", label: dict.history.sleep, color: "var(--accent)" },
                  { key: "fatigue", label: dict.history.fatigue, color: "var(--warn)" },
                  { key: "soreness", label: dict.history.soreness, color: "var(--danger)" },
                ]}
                domain={[1, 10]}
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
                    {p.status === "acute_instability" && (
                      <Badge tone="danger" title={dict.coach.tipAcute}>
                        !
                      </Badge>
                    )}
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
