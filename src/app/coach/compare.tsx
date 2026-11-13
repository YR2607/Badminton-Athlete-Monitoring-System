"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n";
import { SeriesLineChart, type SeriesDef, type SeriesPoint } from "@/components/charts/series-chart";
import { EmptyChart } from "@/components/charts/chart-ui";
import { cn } from "@/lib/utils";

/** More than this many lines turns a comparison chart into spaghetti. */
const MAX_SELECTED = 5;

const PALETTE = [
  "var(--accent)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--warn)",
  "var(--chart-6)",
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
    () => new Set(athletes.filter((a) => a.flagged).slice(0, MAX_SELECTED).map((a) => a.id)),
  );
  const atCap = selected.size >= MAX_SELECTED;

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
      { key: "avg", label: d.groupAvg, color: "var(--chart-muted)", dash: true },
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
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }

  if (athletes.length === 0) return <p className="text-sm text-muted">—</p>;

  // Chips: flagged athletes first (those are the ones a coach looks for),
  // then by name for a predictable scan order.
  const chips = [...athletes].sort(
    (a, b) => Number(b.flagged) - Number(a.flagged) || a.name.localeCompare(b.name),
  );
  const withData = athletes.filter((a) => a.series.length > 0).length;

  return (
    <div>
      {data.length === 0 ? (
        <EmptyChart text={dict.common.noData} />
      ) : (
        <SeriesLineChart data={data} series={series} domain={[0, 100]} height={220} />
      )}
      <p className="mt-2 text-[11px] text-muted">
        {d.compareShown
          .replace("{shown}", String(selected.size))
          .replace("{total}", String(athletes.length))
          .replace("{withData}", String(withData))}
        {atCap ? ` · ${d.compareMax.replace("{n}", String(MAX_SELECTED))}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((a) => {
          const on = selected.has(a.id);
          const disabled = !on && atCap;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              disabled={disabled}
              title={disabled ? d.compareMax.replace("{n}", String(MAX_SELECTED)) : undefined}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                on ? "bg-surface font-semibold" : "border-border text-muted",
                disabled && "opacity-40",
              )}
              style={on ? { borderColor: colorOf.get(a.id) } : undefined}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: on ? colorOf.get(a.id) : "var(--border)" }}
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
