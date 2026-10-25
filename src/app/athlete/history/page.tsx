import { getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { addDays, localDate, todayInTz } from "@/lib/dates";
import { dailyConditionSeries, postsByLocalDate } from "@/lib/readiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart } from "@/components/charts/series-chart";
import type { MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function localTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const profile = (await getCurrentProfile())!;
  const athlete = (await getCurrentAthlete())!;
  const dict = getDictionary(profile.preferred_language);
  const h = dict.history;
  const supabase = await createClient();
  const tz = profile.timezone;
  const today = todayInTz(tz);
  const sp = await searchParams;
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const from = addDays(today, -(days - 1));

  const [{ data: checkins }, { data: sessions }, { data: postCheckins }] = await Promise.all([
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athlete.id)
      .gte("checkin_date", from)
      .order("checkin_date", { ascending: true }),
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", athlete.id)
      .gte("started_at", `${from}T00:00:00Z`)
      .order("started_at", { ascending: true }),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", athlete.id)
      .gte("submitted_at", `${from}T00:00:00Z`),
  ]);

  const ck = (checkins as MorningCheckin[]) ?? [];
  const ss = ((sessions as TrainingSession[]) ?? []).filter(
    (s) => localDate(new Date(s.started_at), tz) >= from,
  );

  const last7 = ck.filter((c) => c.checkin_date >= addDays(today, -6));
  const last30 = ck.filter((c) => c.checkin_date >= addDays(today, -29));

  const avgRow = (label: string, get: (c: MorningCheckin) => number) => (
    <tr key={label} className="border-b border-border last:border-0">
      <td className="py-2 text-sm">{label}</td>
      <td className="py-2 text-right text-sm">{avg(last7.map(get)) ?? "—"}</td>
      <td className="py-2 text-right text-sm">{avg(last30.map(get)) ?? "—"}</td>
    </tr>
  );

  const readinessSeries = dailyConditionSeries(
    ck,
    postsByLocalDate((postCheckins as PostTrainingCheckin[]) ?? [], tz),
  );
  const wellbeingSeries = ck.map((c) => ({
    date: c.checkin_date,
    sleep: c.sleep_score,
    fatigue: c.fatigue_score,
    soreness: c.muscle_soreness_score,
  }));

  const painEntries = ck.filter((c) => c.pain_status !== "none");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{h.title}</h1>
        <div className="flex gap-1">
          {[7, 14, 30, 90].map((n) => (
            <a
              key={n}
              href={`/athlete/history?days=${n}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${days === n ? "bg-accent text-white" : "bg-foreground/5"}`}
            >
              {n}
            </a>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{h.averages}</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-right font-medium">{h.last7}</th>
                <th className="pb-2 text-right font-medium">{h.last30}</th>
              </tr>
            </thead>
            <tbody>
              {avgRow(h.sleep, (c) => c.sleep_score)}
              {avgRow(h.recovery, (c) => c.recovery_score)}
              {avgRow(h.fatigue, (c) => c.fatigue_score)}
              {avgRow(h.soreness, (c) => c.muscle_soreness_score)}
              {avgRow(h.stress, (c) => c.stress_score)}
              {avgRow(h.mood, (c) => c.mood_score)}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{h.readiness}</CardTitle>
        </CardHeader>
        <CardContent>
          {readinessSeries.length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <SeriesLineChart
              data={readinessSeries}
              series={[{ key: "score", label: h.readiness, color: "#2563eb" }]}
              domain={[0, 100]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {h.sleep} · {h.fatigue} · {h.soreness}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wellbeingSeries.length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <SeriesLineChart
              data={wellbeingSeries}
              series={[
                { key: "sleep", label: h.sleep, color: "#2563eb" },
                { key: "fatigue", label: h.fatigue, color: "#d97706" },
                { key: "soreness", label: h.soreness, color: "#dc2626" },
              ]}
              domain={[1, 5]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{h.trainings}</CardTitle>
        </CardHeader>
        <CardContent>
          {ss.length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ss
                .slice()
                .reverse()
                .map((s) => (
                  <li key={s.id} className="flex justify-between py-2">
                    <span>{localDate(new Date(s.started_at), tz)}</span>
                    <span className="text-muted">
                      {localTime(s.started_at, tz)}
                      {s.duration_minutes != null ? ` · ${s.duration_minutes} ${dict.common.minutes}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{h.painHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {painEntries.length === 0 ? (
            <p className="text-sm text-muted">{h.noPain}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {painEntries
                .slice()
                .reverse()
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>{c.checkin_date}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted">{c.pain_location ?? c.pain_status}</span>
                      {c.pain_status === "acute_instability" && <Badge tone="danger">!</Badge>}
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
