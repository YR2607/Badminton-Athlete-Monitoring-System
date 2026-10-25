"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n";
import { SeriesLineChart, type SeriesDef, type SeriesPoint } from "@/components/charts/series-chart";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#4c7c0b",
  "#dc2626",
  "#d97706",
  "#0e7490",
  "#be185d",
  "#6d28d9",
  "#161b0c",
  "#a16207",
];

export interface CompareAthlete {
  id: string;
  name: string;
  flagged: boolean;
  series: { date: string; score: number }[];
}

export function CompareChart({
  athletes,
  dict,
}: {
  athletes: CompareAthlete[];
  dict: Dictionary;
}) {
  const d = dict.coach;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(athletes.filter((a) => a.flagged).map((a) => a.id)),
  );

  const { data, series, colorOf } = useMemo(() => {
    const dates = [...new Set(athletes.flatMap((a) => a.series.map((p) => p.date)))].sort();
    const byAthlete = new Map(
      athletes.map((a) => [a.id, new Map(a.series.map((p) => [p.date, p.score]))]),
    );
    const data: SeriesPoint[] = dates.map((date) => {
      const row: SeriesPoint = { date };
      let sum = 0;
      let n = 0;
      for (const a of athletes) {
        const v = byAthlete.get(a.id)?.get(date);
        if (v !== undefined) {
          sum += v;
          n++;
          if (selected.has(a.id)) row[`a_${a.id}`] = Math.round(v * 10) / 10;
        }
      }
      row.avg = n ? Math.round((sum / n) * 10) / 10 : null;
      return row;
    });
    const colorOf = new Map<string, string>();
    const series: SeriesDef[] = [
      { key: "avg", label: d.groupAvg, color: "#9aa38a", dash: true },
    ];
    let i = 0;
    for (const a of athletes) {
      if (!selected.has(a.id)) continue;
      const color = PALETTE[i % PALETTE.length];
      i++;
      colorOf.set(a.id, color);
      series.push({ key: `a_${a.id}`, label: a.name, color });
    }
    return { data, series, colorOf };
  }, [athletes, selected, d.groupAvg]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (athletes.length === 0) return <p className="text-sm text-muted">—</p>;

  return (
    <div>
      {data.length === 0 ? (
        <p className="text-sm text-muted">{dict.common.noData}</p>
      ) : (
        <SeriesLineChart data={data} series={series} domain={[0, 100]} height={220} />
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {athletes.map((a) => {
          const on = selected.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                on
                  ? "border-transparent bg-foreground/10"
                  : "border-border text-muted",
              )}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: on ? colorOf.get(a.id) : "#ccd0b8" }}
              />
              {a.name}
              {a.flagged && <span className="text-danger">!</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
