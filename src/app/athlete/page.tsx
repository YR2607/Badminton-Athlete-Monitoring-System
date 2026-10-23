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

  const [{ data: todayCheckin }, { data: postToday }, { data: snapshot }, { data: recent }, { data: memberships }] =
    await Promise.all([
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).eq("checkin_date", today).maybeSingle(),
      supabase.from("post_training_checkins").select("*").eq("athlete_id", athlete.id).gte("submitted_at", `${since30}T00:00:00Z`),
      supabase.from("readiness_snapshots").select("*").eq("athlete_id", athlete.id).eq("snapshot_date", today).maybeSingle(),
      supabase.from("morning_checkins").select("*").eq("athlete_id", athlete.id).gte("checkin_date", since30).order("checkin_date", { ascending: false }),
      supabase.from("group_memberships").select("group_id").eq("athlete_id", athlete.id).is("left_at", null),
    ]);

  const posts = ((postToday as PostTrainingCheckin[]) ?? []).filter(
    (p) => localDate(new Date(p.submitted_at), tz) === today,
  );

  const groupIds = (memberships ?? []).map((m) => m.group_id);
  const { data: schedules } = groupIds.length
    ? await supabase
        .from("training_schedules")
        .select("weekday")
        .in("group_id", groupIds)
        .eq("active", true)
    : { data: [] };
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const scheduledToday = (schedules ?? []).some((s) => s.weekday === todayWeekday);

  const morningDone = !!todayCheckin;
  const postDone = posts.length > 0;
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
