import { createClient } from "@/lib/supabase/server";
import { coachAthleteIds } from "@/lib/coach-data";
import { addDays, todayInTz } from "@/lib/dates";
import { dailyReadiness } from "@/lib/readiness";
import { SeriesLineChart } from "@/components/charts/series-chart";
import type { MorningCheckin } from "@/lib/types";

/** Average readiness across the coach's athletes for the last 7 days. */
export async function GroupTrendChart({ coachProfileId, tz }: { coachProfileId: string; tz: string }) {
  const supabase = await createClient();
  const ids = await coachAthleteIds(supabase, coachProfileId);
  if (ids.length === 0) return <p className="text-sm text-muted">—</p>;
  const today = todayInTz(tz);
  const from = addDays(today, -6);
  const { data } = await supabase
    .from("morning_checkins")
    .select("*")
    .in("athlete_id", ids)
    .gte("checkin_date", from);
  const byDate = new Map<string, number[]>();
  for (const c of (data as MorningCheckin[]) ?? []) {
    const score = dailyReadiness([c])[0]?.score;
    if (score === undefined) continue;
    const list = byDate.get(c.checkin_date) ?? [];
    list.push(score);
    byDate.set(c.checkin_date, list);
  }
  const points = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date,
      score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    }));
  if (points.length === 0) return <p className="text-sm text-muted">—</p>;
  return (
    <SeriesLineChart
      data={points}
      series={[{ key: "score", label: "Readiness", color: "#2563eb" }]}
      domain={[0, 100]}
      height={200}
    />
  );
}
