"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

export interface SeriesPoint {
  date: string;
  [key: string]: string | number | [number, number] | null;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dash?: boolean;
  /** Soft gradient fill under this line. */
  fill?: boolean;
}

/** Horizontal shaded zone (e.g. the ACWR sweet spot). */
export interface Zone {
  y1: number;
  y2: number;
  color: string;
  label?: string;
}

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
  fontSize: 12,
} as const;

/** "2026-10-24" or "10-24" → "24.10" */
const fmtDate = (v: unknown) => {
  const parts = String(v).split("-");
  return parts.length >= 2 ? `${parts.at(-1)}.${parts.at(-2)}` : String(v);
};

export function SeriesLineChart({
  data,
  series,
  height = 240,
  domain,
  reference,
  markers,
  band,
  zones,
}: {
  data: SeriesPoint[];
  series: SeriesDef[];
  height?: number;
  domain?: [number | "auto", number | "auto"];
  reference?: { y: number; label?: string };
  /** Vertical markers (calendar events) — `date` must match the x-axis key. */
  markers?: { date: string; label: string }[];
  /** Shaded norm band: pair of data keys giving [low, high] per row. */
  band?: { low: string; high: string; color?: string };
  /** Horizontal shaded zones (e.g. optimal range). */
  zones?: Zone[];
}) {
  if (data.length === 0) return null;
  const rows = band
    ? data.map((d) => ({
        ...d,
        __band:
          typeof d[band.low] === "number" && typeof d[band.high] === "number"
            ? ([d[band.low], d[band.high]] as [number, number])
            : null,
      }))
    : data;
  // Deduplicate markers on the same date so labels never stack on top of each other.
  const mergedMarkers = (() => {
    if (!markers?.length) return [];
    const byDate = new Map<string, string[]>();
    for (const m of markers) {
      const list = byDate.get(m.date) ?? [];
      if (!list.includes(m.label)) list.push(m.label);
      byDate.set(m.date, list);
    }
    return [...byDate.entries()].map(([date, labels]) => ({
      date,
      label: labels.join(" / "),
    }));
  })();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={rows}
        margin={{ top: mergedMarkers.length ? 20 : 8, right: 10, left: 0, bottom: 2 }}
      >
        <defs>
          {series
            .filter((s) => s.fill)
            .map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickFormatter={fmtDate}
          tickMargin={6}
          padding={{ left: 6, right: 6 }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          width={30}
          domain={domain ?? ["auto", "auto"]}
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} />
        {series.length > 1 ? (
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconSize={10} />
        ) : null}
        {(zones ?? []).map((z, i) => (
          <ReferenceArea
            key={`zone-${i}`}
            y1={z.y1}
            y2={z.y2}
            fill={z.color}
            fillOpacity={0.1}
            stroke={z.color}
            strokeOpacity={0.25}
            strokeDasharray="4 4"
            label={
              z.label
                ? { value: z.label, position: "insideTopLeft", fontSize: 10, fill: z.color }
                : undefined
            }
          />
        ))}
        {band && (
          <Area
            dataKey="__band"
            stroke="none"
            fill={band.color ?? "var(--accent)"}
            fillOpacity={0.12}
            connectNulls
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
          />
        )}
        {reference ? (
          <ReferenceLine
            y={reference.y}
            stroke="var(--chart-muted)"
            strokeDasharray="4 4"
            label={
              reference.label
                ? {
                    value: reference.label,
                    position: "insideBottomRight",
                    fontSize: 10,
                    fill: "var(--muted)",
                  }
                : undefined
            }
          />
        ) : null}
        {mergedMarkers.map((m, i) => (
          <ReferenceLine
            key={`${m.date}-${i}`}
            x={m.date}
            stroke="var(--chart-marker)"
            strokeDasharray="3 3"
            label={{ value: m.label, position: "top", fontSize: 10, fill: "var(--chart-marker)" }}
          />
        ))}
        {series.map((s) =>
          s.fill ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.dash ? 1.5 : 2}
              strokeDasharray={s.dash ? "5 4" : undefined}
              fill={`url(#grad-${s.key})`}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.dash ? 1.5 : 2}
              strokeDasharray={s.dash ? "5 4" : undefined}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LoadBarChart({
  data,
  height = 220,
  label,
  plannedLabel,
}: {
  data: SeriesPoint[];
  height?: number;
  label: string;
  plannedLabel?: string;
}) {
  if (data.length === 0) return null;
  // Fact bar color vs plan: within plan → ok, mild overrun → warn, spike → danger.
  const factColor = (d: SeriesPoint) => {
    const load = typeof d.load === "number" ? d.load : 0;
    const planned = typeof d.planned === "number" ? d.planned : null;
    if (load === 0) return "var(--chart-planned)";
    if (planned === null || planned <= 0) return "var(--accent)";
    if (load <= planned * 1.25) return "var(--ok)";
    if (load <= planned * 1.5) return "var(--warn)";
    return "var(--danger)";
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 2 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickFormatter={fmtDate}
          tickMargin={6}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          minTickGap={22}
        />
        <YAxis
          width={32}
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--border)", fillOpacity: 0.3 }} />
        {plannedLabel ? (
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconSize={10} />
        ) : null}
        {plannedLabel ? (
          <Bar
            dataKey="planned"
            name={plannedLabel}
            fill="var(--chart-planned)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ) : null}
        <Bar dataKey="load" name={label} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={factColor(d)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
