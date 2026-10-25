import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart, LoadBarChart } from "@/components/charts/series-chart";
import { acwrSeries, type DayLoad } from "@/lib/load";
import { MORNING_ITEM_KEYS, type MorningItemKey } from "@/lib/readiness";
import type { Dictionary } from "@/i18n";
import type { CalendarEvent, ReadinessSnapshot } from "@/lib/types";

/**
 * Athlete dashboard (flag 'athlete_dashboard'). Blocks that need load data
 * are additionally gated on 'srpe', z-score blocks on 'zscore_baseline' —
 * the parent page decides via the `srpe`/`zscore` props.
 */
export function AthleteDashboard({
  dict,
  snapshots,
  loads,
  srpe,
  zscore,
  events = [],
}: {
  dict: Dictionary;
  snapshots: ReadinessSnapshot[];
  loads: DayLoad[];
  srpe: boolean;
  zscore: boolean;
  events?: CalendarEvent[];
}) {
  const d = dict.dashboard;
  const today = snapshots.at(-1);

  // Norm corridor: score line + dashed avg ± 1 SD bounds per day.
  const corridor = snapshots.map((s) => {
    const n = s.score_norm;
    return {
      date: s.snapshot_date,
      score: s.readiness_score,
      normHigh: n ? Math.min(100, n.avg + n.sd) : null,
      normLow: n ? Math.max(0, n.avg - n.sd) : null,
    };
  });

  const load14 = loads.slice(-14);
  const acwrPts = acwrSeries(loads.map((d) => d.load));
  const acwrChart = loads
    .map((d, i) => ({ date: d.date, acwr: acwrPts[i] }))
    .filter((p) => p.acwr !== null);

  const zChip = (z: number | null) => {
    if (z === null || z === undefined) return null;
    const tone = z < -1.5 ? "danger" : z < -1 ? "warn" : "ok";
    return (
      <Badge tone={tone as "danger" | "warn" | "ok"}>
        {d.zLabel}: {z > 0 ? `+${z}` : z}
      </Badge>
    );
  };

  const itemLabel: Record<MorningItemKey, string> = {
    sleep_score: d.itemSleep,
    recovery_score: d.itemRecovery,
    fatigue_score: d.itemFatigue,
    muscle_soreness_score: d.itemSoreness,
    stress_score: d.itemStress,
    mood_score: d.itemMood,
  };

  const itemZ = today?.item_zscores ?? null;

  // Event markers on the corridor chart (x-axis is ISO snapshot_date).
  const markers = events.map((e) => ({ date: e.start_date, label: dict.events.kinds[e.kind] }));

  return (
    <div className="space-y-4">
      {zscore && (
        <Card>
          <CardHeader>
            <CardTitle>{d.corrTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {zChip(today?.z_score ?? null)}
              {today?.score_norm == null && (
                <span className="text-xs text-muted">{d.normForming}</span>
              )}
            </div>
            {corridor.length === 0 ? (
              <p className="text-sm text-muted">{dict.common.noData}</p>
            ) : (
              <SeriesLineChart
                data={corridor}
                series={[
                  { key: "score", label: dict.athleteHome.readiness, color: "var(--accent)" },
                  { key: "normHigh", label: d.corrHigh, color: "var(--chart-muted)", dash: true },
                  { key: "normLow", label: d.corrLow, color: "var(--chart-muted)", dash: true },
                ]}
                domain={[0, 100]}
                markers={markers}
              />
            )}
          </CardContent>
        </Card>
      )}

      {zscore && itemZ && (
        <Card>
          <CardHeader>
            <CardTitle>{d.componentsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MORNING_ITEM_KEYS.map((k) => {
                const z = itemZ[k];
                const cls =
                  z == null
                    ? "border-border text-muted"
                    : z < -1.5
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : z < -1
                        ? "border-warn/40 bg-warn/10 text-warn"
                        : "border-ok/40 bg-ok/10 text-ok";
                return (
                  <div key={k} className={`rounded-lg border px-3 py-2 ${cls}`}>
                    <p className="text-xs font-medium">{itemLabel[k]}</p>
                    <p className="text-sm font-semibold">
                      {z == null ? "—" : z > 0 ? `+${z}` : z}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">{d.componentsHint}</p>
          </CardContent>
        </Card>
      )}

      {srpe && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{d.loadTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {load14.every((x) => !x.hasData && x.planned == null) ? (
                <p className="text-sm text-muted">{dict.common.noData}</p>
              ) : (
                <LoadBarChart
                  data={load14.map((x) => ({
                    date: x.date.slice(5),
                    load: x.hasData ? x.load : 0,
                    planned: x.planned,
                  }))}
                  label={d.fact}
                  plannedLabel={d.plan}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.acwrTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {acwrChart.length === 0 ? (
                <p className="text-sm text-muted">{d.acwrForming}</p>
              ) : (
                <SeriesLineChart
                  data={acwrChart.map((p) => ({
                    date: p.date.slice(5),
                    acwr: Math.round((p.acwr ?? 0) * 100) / 100,
                  }))}
                  series={[{ key: "acwr", label: "ACWR", color: "var(--chart-5)" }]}
                  domain={[0, "auto"]}
                />
              )}
              <p className="mt-2 text-xs text-muted">{d.acwrHint}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
