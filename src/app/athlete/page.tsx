import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, localDate, todayInTz } from "@/lib/dates";
import { dailyConditionSeries, postsByLocalDate, bandForScore } from "@/lib/readiness";
import { dayStatuses, sessionDateByIdMap } from "@/lib/checkins";
import { bandAdviceKey } from "@/lib/alerts";
import { isFlagEnabled } from "@/lib/flags";
import { dailyLoads, plannedForDate, type PlanOverride, type ScheduleInput, type SessionInput } from "@/lib/load";
import { dateRange } from "@/lib/dates";
import { AthleteDashboard } from "@/components/dashboard/athlete-dashboard";
import { EventsPanel } from "@/components/events-panel";
import { AthleteHabitBadges, FieldTestRadar } from "@/components/athlete-radar-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart } from "@/components/charts/series-chart";
import { CheckCircle2, Circle, Sunrise, Sunset } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MorningCheckin, PostTrainingCheckin, ReadinessSnapshot } from "@/lib/types";

export default async function AthleteHome() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const d = dict.athleteHome;
  const supabase = await createClient();
  const tz = profile.timezone;
  const today = todayInTz(tz);
  const since30 = addDays(today, -29);

  const [{ data: todayCheckin }, { data: postToday }, { data: sessionsRecent }, { data: snapshot }, { data: recent }, { data: memberships }] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).eq("checkin_date", today).maybeSingle(),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", athlete.id).gte("submitted_at", `${since30}T00:00:00Z`),
      supabase.from("training_sessions").select("id, started_at").eq("athlete_id", athlete.id).gte("started_at", `${since30}T00:00:00Z`),
      supabase.from("readiness_snapshots").select("*").eq("athlete_id", athlete.id).eq("snapshot_date", today).maybeSingle(),
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).gte("checkin_date", since30).order("checkin_date", { ascending: false }),
      supabase.from("group_memberships").select("group_id").eq("athlete_id", athlete.id).is("left_at", null),
    ]);

  const sessionDateById = sessionDateByIdMap(
    (sessionsRecent as { id: string; started_at: string }[]) ?? [],
    tz,
  );
  const postEntries = postsByLocalDate((postToday as PostTrainingCheckin[]) ?? [], tz, sessionDateById);

  const groupIds = (memberships ?? []).map((m) => m.group_id);
  const [{ data: schedules }, { data: planOverrides }] = groupIds.length
    ? await Promise.all([
        supabase
          .from("training_schedules")
          .select("weekday, planned_minutes, planned_rpe")
          .in("group_id", groupIds)
          .eq("active", true),
        supabase
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
          .in("group_id", groupIds)
          .gte("plan_date", addDays(today, -40))
          .lte("plan_date", today),
      ])
    : [{ data: [] }, { data: [] }];
  const overrides = (planOverrides as PlanOverride[] | null) ?? [];
  const schedInputs = (schedules ?? []) as ScheduleInput[];
  const [todayStatus] = dayStatuses({
    days: [today],
    checkins: todayCheckin ? [todayCheckin as MorningCheckin] : [],
    postEntries,
    scheduledFor: (date) => plannedForDate(date, schedInputs, overrides).scheduled,
  });
  const scheduledToday = todayStatus.scheduled === true;
  const morningDone = todayStatus.morning !== null;
  const postDone = todayStatus.evening !== null;
  const doneCount = (morningDone ? 1 : 0) + (postDone ? 1 : 0);

  const snap = snapshot as ReadinessSnapshot | null;
  const score = snap?.readiness_score ?? null;
  const band = score !== null ? bandForScore(score) : null;
  const adviceKey = bandAdviceKey(score);
  const adviceText =
    adviceKey === "nodata"
      ? d.readinessNoData
      : adviceKey === "good"
        ? d.readinessGood
        : adviceKey === "moderate"
          ? d.readinessModerate
          : d.readinessLow;

  const series = dailyConditionSeries(
    (recent as MorningCheckin[]) ?? [],
    postEntries,
  );
  const chart7 = series.filter((p) => p.date >= addDays(today, -6));
  const cardEmpty = !athlete.preferred_discipline && !athlete.season_goal;

  // Dashboard data (behind flags; queries only run when enabled).
  const dashboardOn = await isFlagEnabled("athlete_dashboard", groupIds);
  const srpeOn = await isFlagEnabled("srpe", groupIds);
  const zscoreOn = await isFlagEnabled("zscore_baseline", groupIds);
  let snap30: ReadinessSnapshot[] = [];
  let dayLoads: ReturnType<typeof dailyLoads> = [];
  if (dashboardOn && (zscoreOn || srpeOn)) {
    const since40 = addDays(today, -39);
    const [{ data: snaps }, { data: sessions }] = await Promise.all([
      supabase
        .from("readiness_snapshots")
        .select("*")
        .eq("athlete_id", athlete.id)
        .gte("snapshot_date", since30)
        .order("snapshot_date", { ascending: true }),
      supabase
        .from("training_sessions")
        .select("started_at, session_rpe, duration_minutes")
        .eq("athlete_id", athlete.id)
        .gte("started_at", `${since40}T00:00:00Z`),
    ]);
    snap30 = (snaps as ReadinessSnapshot[]) ?? [];
    const sessionInputs: SessionInput[] = ((sessions as { started_at: string; session_rpe: number | null; duration_minutes: number | null }[] | null) ?? []).map(
      (s) => ({
        date: localDate(new Date(s.started_at), tz),
        rpe: s.session_rpe,
        minutes: s.duration_minutes,
      }),
    );
    dayLoads = dailyLoads(
      dateRange(since40, today),
      sessionInputs,
      (schedules ?? []).map((s) => ({
        weekday: s.weekday,
        planned_minutes: s.planned_minutes,
        planned_rpe: s.planned_rpe,
      })),
      overrides,
    );
  }

  // Phase 9: engagement card — check-in streak + a simple personal insight
  // (only with enough data; no alarming wording).
  const engageOn = await isFlagEnabled("push", groupIds);
  const recentList = (recent as MorningCheckin[]) ?? [];
  const filledSet = new Set(recentList.map((c) => c.checkin_date));
  let streak = 0;
  for (let i = 0; i <= 60; i++) {
    const day = addDays(today, -i);
    if (filledSet.has(day)) streak++;
    else if (i === 0) continue; // today may not be filled yet — start from yesterday
    else break;
  }
  const scoreByDate = new Map(series.map((s) => [s.date, s.score]));
  const withSleep = recentList.filter((c) => c.sleep_hours != null && scoreByDate.has(c.checkin_date));
  const hiSleep = withSleep.filter((c) => (c.sleep_hours ?? 0) >= 8.5);
  const loSleep = withSleep.filter((c) => (c.sleep_hours ?? 0) < 8.5);
  let sleepDiff: number | null = null;
  if (hiSleep.length >= 4 && loSleep.length >= 4) {
    const avg = (arr: MorningCheckin[]) =>
      arr.reduce((x, c) => x + scoreByDate.get(c.checkin_date)!, 0) / arr.length;
    const diff = avg(hiSleep) - avg(loSleep);
    if (diff >= 3) sleepDiff = Math.round(diff);
  }

  // 7-day personal passport (Metrifit-style summary for teen engagement).
  const since7 = addDays(today, -6);
  const prev7From = addDays(today, -13);
  const checkins7 = recentList.filter((c) => c.checkin_date >= since7 && c.checkin_date <= today);
  const sleep7Vals = checkins7
    .map((c) => c.sleep_hours)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const sleepPrevVals = recentList
    .filter((c) => c.checkin_date >= prev7From && c.checkin_date < since7)
    .map((c) => c.sleep_hours)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgSleep7 = sleep7Vals.length
    ? Math.round((sleep7Vals.reduce((a, b) => a + b, 0) / sleep7Vals.length) * 10) / 10
    : null;
  const avgSleepPrev = sleepPrevVals.length
    ? Math.round((sleepPrevVals.reduce((a, b) => a + b, 0) / sleepPrevVals.length) * 10) / 10
    : null;
  const sleepDelta7 =
    avgSleep7 !== null && avgSleepPrev !== null
      ? Math.round((avgSleep7 - avgSleepPrev) * 10) / 10
      : null;
  const sessions7Count = ((sessionsRecent as { id: string; started_at: string }[] | null) ?? []).filter(
    (s) => {
      const sd = localDate(new Date(s.started_at), tz);
      return sd >= since7 && sd <= today;
    },
  ).length;
  const avgScore7 = chart7.length
    ? Math.round(chart7.reduce((a, p) => a + p.score, 0) / chart7.length)
    : null;

  // Phase 3: weekly OSTRC-O2 survey prompt (flag 'ostrc' + parental consent).
  const ostrcOn = await isFlagEnabled("ostrc", groupIds);
  let ostrcDue = false;
  if (ostrcOn) {
    const { isoWeekMonday } = await import("@/lib/ostrc");
    const [{ data: consent }, { data: wk }] = await Promise.all([
      supabase
        .from("consent_records")
        .select("status")
        .eq("athlete_id", athlete.id)
        .eq("consent_type", "parental_data_processing")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("ostrc_responses")
        .select("id")
        .eq("athlete_id", athlete.id)
        .eq("week_start_date", isoWeekMonday(today))
        .limit(1),
    ]);
    ostrcDue = consent?.status === "granted" && !(wk ?? []).length;
  }

  // Phase 5: context calendar (flag 'events') — own + group events.
  const eventsOn = await isFlagEnabled("events", groupIds);
  let eventRows: import("@/lib/types").CalendarEvent[] = [];
  if (eventsOn) {
    const { data: ev } = groupIds.length
      ? await supabase
          .from("calendar_events")
          .select("*")
          .or(`athlete_id.eq.${athlete.id},group_id.in.(${groupIds.join(",")})`)
          .order("start_date", { ascending: false })
          .limit(20)
      : await supabase
          .from("calendar_events")
          .select("*")
          .eq("athlete_id", athlete.id)
          .order("start_date", { ascending: false })
          .limit(20);
    eventRows = (ev as import("@/lib/types").CalendarEvent[] | null) ?? [];
  }

  // Field tests for the athlete's physical radar (flag 'field_tests').
  const testsOn = await isFlagEnabled("field_tests", groupIds);
  let fieldTests: import("@/lib/types").FieldTest[] = [];
  let testResults: import("@/lib/types").FieldTestResult[] = [];
  const groupMedian: Record<string, number | null> = {};
  if (testsOn) {
    const [{ data: tRows }, { data: rRows }] = await Promise.all([
      supabase.from("field_tests").select("*").eq("active", true).order("sort_order"),
      supabase.from("field_test_results").select("*").eq("athlete_id", athlete.id),
    ]);
    fieldTests = (tRows as import("@/lib/types").FieldTest[] | null) ?? [];
    testResults = (rRows as import("@/lib/types").FieldTestResult[] | null) ?? [];
  }

  const painToday = (todayCheckin as MorningCheckin | null)?.pain_status !== "none" && todayCheckin;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">
          {d.greeting}, {profile.display_name}
        </h1>
        <p className="text-sm text-muted">{today}</p>
      </div>

      {painToday ? (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">{d.painNotice}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            {d.todayStatus}
            <span className="text-sm font-normal text-muted">
              {d.progressOf.replace("{done}", String(doneCount)).replace("{total}", "2")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            {
              key: "morning",
              done: morningDone,
              icon: <Sunrise size={20} />,
              label: d.morningLabel,
              href: "/athlete/morning",
            },
            {
              key: "post",
              done: postDone,
              icon: <Sunset size={20} />,
              label: d.postLabel,
              href: "/athlete/training",
            },
          ].map((row) => (
            <div
              key={row.key}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border p-3",
                row.done ? "border-ok/30 bg-ok/5" : "border-warn/40 bg-warn/5",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                {row.done ? (
                  <CheckCircle2 className="shrink-0 text-ok" size={22} />
                ) : (
                  <Circle className="shrink-0 text-warn" size={22} />
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="text-muted">{row.icon}</span>
                    {row.label}
                  </p>
                  <p className={cn("text-xs", row.done ? "text-ok" : "text-warn")}>
                    {row.done
                      ? d.filled
                      : row.key === "post" && !scheduledToday
                        ? d.noTrainingScheduled
                        : d.notFilled}
                  </p>
                </div>
              </div>
              {!row.done && (
                <Link href={row.href} className="shrink-0">
                  <Button
                    size="sm"
                    variant={row.key === "post" && !scheduledToday ? "secondary" : "default"}
                  >
                    {d.fillBtn}
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.readiness}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span
              className="text-4xl font-bold"
              style={{
                color: band === "good" ? "var(--ok)" : band === "moderate" ? "var(--warn)" : band ? "var(--danger)" : "var(--muted)",
              }}
            >
              {score !== null ? Math.round(score) : "—"}
            </span>
            <div>
              <p className="text-sm">{adviceText}</p>
              {snap && snap.confidence === "insufficient" && (
                <Badge tone="neutral" className="mt-1">{dict.common.insufficientData}</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {ostrcDue && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="flex items-center justify-between gap-3 pt-4">
            <p className="text-sm">{dict.ostrc.homeCard}</p>
            <Link href="/athlete/ostrc">
              <Button size="sm">{dict.ostrc.fillNow}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {cardEmpty && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="flex items-center justify-between gap-3 pt-4">
            <p className="text-sm">🏸 {dict.card.fillBanner}</p>
            <Link href="/athlete/settings">
              <Button size="sm" variant="secondary">
                {dict.card.fillBtn}
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {engageOn && (streak >= 2 || sleepDiff !== null) && (
        <Card>
          <CardContent className="space-y-1.5 pt-4 text-sm">
            {streak >= 2 && (
              <p>
                🔥 {d.streak.replace("{n}", String(streak))}
              </p>
            )}
            {sleepDiff !== null && (
              <p className="text-muted">{d.sleepInsight.replace("{d}", String(sleepDiff))}</p>
            )}
          </CardContent>
        </Card>
      )}

      {checkins7.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{d.weekPassportTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <p className="text-xs text-muted">{d.weekPassportCheckins}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{checkins7.length}/7</p>
              </div>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <p className="text-xs text-muted">{d.weekPassportSessions}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{sessions7Count}</p>
              </div>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <p className="text-xs text-muted">{d.weekPassportReadiness}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{avgScore7 ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <p className="text-xs text-muted">{d.weekPassportSleep}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">
                  {avgSleep7 !== null ? `${avgSleep7} ${d.weekPassportHours}` : "—"}
                  {sleepDelta7 !== null && sleepDelta7 !== 0 && (
                    <span
                      className={`ml-1.5 text-xs font-medium ${
                        sleepDelta7 > 0 ? "text-ok" : "text-warn"
                      }`}
                    >
                      {sleepDelta7 > 0 ? `+${sleepDelta7}` : sleepDelta7}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AthleteHabitBadges
        dict={dict}
        streak={streak}
        recentCheckins={recentList}
        sessions7Count={sessions7Count}
      />

      {testsOn && fieldTests.length > 0 && testResults.length > 0 && (
        <FieldTestRadar
          dict={dict}
          lang={profile.preferred_language}
          tests={fieldTests}
          ownResults={testResults}
          groupMedian={groupMedian}
        />
      )}

      {eventsOn && (
        <EventsPanel dict={dict} events={eventRows} athleteId={athlete.id} mode="athlete" />
      )}

      {dashboardOn && (srpeOn || zscoreOn) && (
        <AthleteDashboard
          dict={dict}
          snapshots={snap30}
          loads={dayLoads}
          srpe={srpeOn}
          zscore={zscoreOn}
          events={eventsOn ? eventRows : []}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{d.weekChart}</CardTitle>
        </CardHeader>
        <CardContent>
          {chart7.length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <SeriesLineChart
              data={chart7}
              series={[{ key: "score", label: d.readiness, color: "var(--accent)" }]}
              domain={[0, 100]}
              reference={snap?.baseline_avg != null ? { y: Number(snap.baseline_avg) } : undefined}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.lastEntries}</CardTitle>
        </CardHeader>
        <CardContent>
          {((recent as MorningCheckin[]) ?? []).length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <ul className="divide-y divide-border">
              {((recent as MorningCheckin[]) ?? []).slice(0, 7).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.checkin_date}</span>
                  <span className="text-muted">
                    {dict.history.sleep} {c.sleep_score} · {dict.history.fatigue} {c.fatigue_score} ·{" "}
                    {dict.history.soreness} {c.muscle_soreness_score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
