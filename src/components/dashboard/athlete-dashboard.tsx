import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesLineChart, LoadBarChart } from "@/components/charts/series-chart";
import { EmptyChart, InsightLine } from "@/components/charts/chart-ui";
import { acwrSeries, analyzeLoadWave, loadCoverage, type DayLoad } from "@/lib/load";
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
  // Wave classification only trusts quantified days — partial/unknown are
  // gaps, not zeros.
  const wave14 = analyzeLoadWave(
    load14.map((x) => ({ date: x.date, load: x.state === "known" ? x.load : 0 })),
  );
  const coverage = loadCoverage(loads);
  const acwrPts = coverage.reliable ? acwrSeries(loads.map((d) => d.load)) : [];
  const acwrChart = loads
    .map((d, i) => ({ date: d.date, acwr: acwrPts[i] }))
    .filter((p) => p.acwr !== null);
  const acwrNow = acwrChart.at(-1)?.acwr ?? null;
  const acwrTone =
    acwrNow === null ? "neutral" : acwrNow < 0.8 ? "warn" : acwrNow <= 1.3 ? "ok" : "danger";

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

  // Deterministic interpretation for the readiness corridor.
  const lastCorridor = corridor.at(-1);
  const todayHasPoint = corridor.some((c) => c.score !== null && c.date === loads.at(-1)?.date);
  const belowNorm =
    lastCorridor?.score != null &&
    lastCorridor.normLow != null &&
    lastCorridor.score < lastCorridor.normLow;

  return (
    <div className="space-y-4">
      {zscore && (
        <Card>
          <CardHeader>
            <CardTitle>{d.corrTitle}</CardTitle>
            <p className="text-xs text-muted">{d.corrHint}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {zChip(today?.z_score ?? null)}
              {today?.score_norm == null && (
                <span className="text-xs text-muted">{d.normForming}</span>
              )}
            </div>
            {corridor.length === 0 ? (
              <EmptyChart text={dict.common.noData} />
            ) : (
              <SeriesLineChart
                data={corridor}
                series={[{ key: "score", label: dict.athleteHome.readiness, color: "var(--accent)", fill: true }]}
                band={{ low: "normLow", high: "normHigh" }}
                domain={[0, 100]}
                markers={markers}
              />
            )}
            {belowNorm && <InsightLine tone="warn">{d.insightBelowNorm}</InsightLine>}
            {!belowNorm && !todayHasPoint && corridor.length > 0 && (
              <InsightLine>{d.insightNoToday}</InsightLine>
            )}
          </CardContent>
        </Card>
      )}

      {zscore && itemZ && (
        <Card>
          <CardHeader>
            <CardTitle>{d.componentsTitle}</CardTitle>
            <p className="text-xs text-muted">{d.componentsHint}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MORNING_ITEM_KEYS.map((k) => {
                const z = itemZ[k];
                const tone =
                  z == null ? "neutral" : z < -1.5 ? "danger" : z < -1 ? "warn" : "ok";
                const width = z == null ? 0 : Math.min(100, (Math.abs(z) / 2) * 100);
                return (
                  <div key={k} className={`rounded-lg border px-3 py-2 ${{
                    neutral: "border-border text-muted",
                    danger: "border-danger/40 bg-danger/10",
                    warn: "border-warn/40 bg-warn/10",
                    ok: "border-ok/40 bg-ok/10",
                  }[tone]}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-medium">{itemLabel[k]}</p>
                      <p className={`text-sm font-semibold tabular-nums ${{
                        neutral: "text-muted",
                        danger: "text-danger",
                        warn: "text-warn",
                        ok: "text-ok",
                      }[tone]}`}>
                        {z == null ? "—" : z > 0 ? `+${z}` : z}
                      </p>
                    </div>
                    <div className="mt-1.5 h-1 rounded bg-foreground/10">
                      <div
                        className={`h-1 rounded ${{
                          neutral: "bg-foreground/20",
                          danger: "bg-danger",
                          warn: "bg-warn",
                          ok: "bg-ok",
                        }[tone]}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {srpe && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{d.loadTitle}</CardTitle>
              <p className="text-xs text-muted">{d.waveLegend}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {load14.every((x) => !x.hasData && x.planned == null) ? (
                <EmptyChart text={dict.common.noData} />
              ) : (
                <>
                  <LoadBarChart
                    data={load14.map((x) => ({
                      date: x.date.slice(5),
                      load: x.load,
                      planned: x.planned,
                      wave: wave14.tags.get(x.date) ?? null,
                      state: x.state,
                    }))}
                    label={d.fact}
                    plannedLabel={d.plan}
                  />
                  {wave14.status !== "insufficient" && (
                    <InsightLine
                      tone={wave14.status === "monotonous" ? "warn" : "ok"}
                      right={
                        <>
                          {d.wavePeaks.replace("{p}", String(wave14.peaks))} ·{" "}
                          {d.waveRecoveries.replace("{r}", String(wave14.recoveries))} ·{" "}
                          {d.waveAvg.replace("{m}", String(wave14.meanActive))}
                        </>
                      }
                    >
                      {wave14.status === "monotonous" ? `⚠️ ${d.waveMonotonous}` : `✅ ${d.waveGood}`}
                    </InsightLine>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.acwrTitle}</CardTitle>
              <p className="text-xs text-muted">{d.acwrHint}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {acwrChart.length === 0 ? (
                <EmptyChart text={d.acwrForming} />
              ) : (
                <>
                  <SeriesLineChart
                    data={acwrChart.map((p) => ({
                      date: p.date.slice(5),
                      acwr: Math.round((p.acwr ?? 0) * 100) / 100,
                    }))}
                    series={[{ key: "acwr", label: "ACWR", color: "var(--accent)" }]}
                    zones={[
                      { y1: 0.8, y2: 1.3, color: "var(--ok)", label: "0.8–1.3" },
                      { y1: 1.5, y2: 2.5, color: "var(--danger)", label: ">1.5" },
                    ]}
                    domain={[0, "auto"]}
                  />
                  {acwrNow !== null && (
                    <InsightLine tone={acwrTone}>
                      {`ACWR ${acwrNow.toFixed(2)} — ${
                        acwrNow < 0.8
                          ? d.acwrNowLow
                          : acwrNow <= 1.3
                            ? d.acwrNowSweet
                            : d.acwrNowHigh
                      }`}
                    </InsightLine>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
