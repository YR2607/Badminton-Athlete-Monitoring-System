import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, localDate, todayInTz } from "@/lib/dates";
import { dailyConditionSeries, postsByLocalDate, bandForScore } from "@/lib/readiness";
import { bandAdviceKey } from "@/lib/alerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart } from "@/components/charts/series-chart";
import { ClipboardList, Dumbbell, CheckCircle2 } from "lucide-react";
import type { MorningCheckin, PostTrainingCheckin, ReadinessSnapshot, TrainingSession } from "@/lib/types";

export default async function AthleteHome() {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const d = dict.athleteHome;
  const supabase = await createClient();
  const tz = profile.timezone;
  const today = todayInTz(tz);
  const since30 = addDays(today, -29);

  const [{ data: todayCheckin }, { data: sessionsToday }, { data: postToday }, { data: snapshot }, { data: recent }] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).eq("checkin_date", today).maybeSingle(),
      supabase.from("training_sessions").select("*").eq("athlete_id", athlete.id).gte("started_at", `${addDays(today, -2)}T00:00:00Z`),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", athlete.id).gte("submitted_at", `${since30}T00:00:00Z`),
      supabase.from("readiness_snapshots").select("*").eq("athlete_id", athlete.id).eq("snapshot_date", today).maybeSingle(),
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).gte("checkin_date", since30).order("checkin_date", { ascending: false }),
    ]);

  const sessions = ((sessionsToday as TrainingSession[]) ?? []).filter(
    (s) => localDate(new Date(s.started_at), tz) === today,
  );
  const posts = ((postToday as PostTrainingCheckin[]) ?? []).filter(
    (p) => localDate(new Date(p.submitted_at), tz) === today,
  );
  const pendingPosts = sessions.filter((s) => !posts.some((p) => p.training_session_id === s.id));

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
    postsByLocalDate((postToday as PostTrainingCheckin[]) ?? [], tz),
  );
  const chart7 = series.filter((p) => p.date >= addDays(today, -6));
  const chart30 = series;

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

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-4">
            <div className="flex items-center gap-2">
              {todayCheckin ? (
                <CheckCircle2 className="text-ok" size={20} />
              ) : (
                <ClipboardList className="text-warn" size={20} />
              )}
              <span className="text-sm font-medium">
                {todayCheckin ? d.morningDone : d.morningPending}
              </span>
            </div>
            {!todayCheckin && (
              <Link href="/athlete/morning">
                <Button size="sm">{d.fillMorning}</Button>
              </Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-4">
            <div className="flex items-center gap-2">
              <Dumbbell className="text-muted" size={20} />
              <span className="text-sm font-medium">
                {sessions.length === 0
                  ? d.noTrainingToday
                  : pendingPosts.length === 0
                    ? d.postDone
                    : d.postPending}
              </span>
            </div>
            <Link href="/athlete/training">
              <Button size="sm" variant="secondary">
                {sessions.length === 0 ? d.addTraining : d.fillPost}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{d.readiness}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span
              className="text-4xl font-bold"
              style={{
                color: band === "good" ? "#16a34a" : band === "moderate" ? "#d97706" : band ? "#dc2626" : "#5b6b83",
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

      <div className="grid gap-4 lg:grid-cols-2">
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
                series={[{ key: "score", label: d.readiness, color: "#2563eb" }]}
                domain={[0, 100]}
                reference={snap?.baseline_avg != null ? { y: Number(snap.baseline_avg) } : undefined}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{d.monthChart}</CardTitle>
          </CardHeader>
          <CardContent>
            {chart30.length === 0 ? (
              <p className="text-sm text-muted">{dict.common.noData}</p>
            ) : (
              <SeriesLineChart
                data={chart30}
                series={[{ key: "score", label: d.readiness, color: "#2563eb" }]}
                domain={[0, 100]}
                reference={snap?.baseline_avg != null ? { y: Number(snap.baseline_avg) } : undefined}
              />
            )}
          </CardContent>
        </Card>
      </div>

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
