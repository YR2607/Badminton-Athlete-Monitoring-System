"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";

export interface SeriesPoint {
  date: string;
  [key: string]: string | number | null;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dash?: boolean;
}

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
  fontSize: 12,
} as const;

export function SeriesLineChart({
  data,
  series,
  height = 240,
  domain,
  reference,
  markers,
}: {
  data: SeriesPoint[];
  series: SeriesDef[];
  height?: number;
  domain?: [number | "auto", number | "auto"];
  reference?: { y: number; label?: string };
  /** Vertical markers (calendar events) — `date` must match the x-axis key. */
  markers?: { date: string; label: string }[];
}) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} tickMargin={6} />
        <YAxis domain={domain ?? ["auto", "auto"]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <Tooltip contentStyle={tooltipStyle} />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {reference ? (
          <ReferenceLine y={reference.y} stroke="var(--chart-muted)" strokeDasharray="4 4" label={reference.label} />
        ) : null}
        {(markers ?? []).map((m, i) => (
          <ReferenceLine
            key={`${m.date}-${i}`}
            x={m.date}
            stroke="var(--chart-marker)"
            strokeDasharray="3 3"
            label={{ value: m.label, position: "insideTopRight", fontSize: 10, fill: "var(--chart-marker)" }}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={s.dash ? 1.5 : 2}
            strokeDasharray={s.dash ? "5 4" : undefined}
            dot={{ r: 2.5 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} tickMargin={6} />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <Tooltip contentStyle={tooltipStyle} />
        {plannedLabel ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {plannedLabel ? (
          <Bar dataKey="planned" name={plannedLabel} fill="var(--chart-muted)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ) : null}
        <Bar dataKey="load" name={label} fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
