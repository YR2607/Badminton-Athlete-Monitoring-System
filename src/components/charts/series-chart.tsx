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
        <CartesianGrid strokeDasharray="3 3" stroke="#233350" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8fa0bd" }} tickMargin={6} axisLine={{ stroke: "#233350" }} tickLine={false} />
        <YAxis domain={domain ?? ["auto", "auto"]} tick={{ fontSize: 11, fill: "#8fa0bd" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#16233c",
            border: "1px solid #233350",
            borderRadius: 8,
            fontSize: 12,
            color: "#edf2fa",
          }}
          labelStyle={{ color: "#8fa0bd" }}
        />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {reference ? (
          <ReferenceLine y={reference.y} stroke="#8fa0bd" strokeDasharray="4 4" label={reference.label} />
        ) : null}
        {(markers ?? []).map((m, i) => (
          <ReferenceLine
            key={`${m.date}-${i}`}
            x={m.date}
            stroke="#fbbf24"
            strokeDasharray="3 3"
            label={{ value: m.label, position: "insideTopRight", fontSize: 10, fill: "#fbbf24" }}
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
        <CartesianGrid strokeDasharray="3 3" stroke="#233350" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8fa0bd" }} tickMargin={6} axisLine={{ stroke: "#233350" }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#8fa0bd" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#16233c",
            border: "1px solid #233350",
            borderRadius: 8,
            fontSize: 12,
            color: "#edf2fa",
          }}
          labelStyle={{ color: "#8fa0bd" }}
        />
        {plannedLabel ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {plannedLabel ? (
          <Bar dataKey="planned" name={plannedLabel} fill="#3a4a68" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ) : null}
        <Bar dataKey="load" name={label} fill="#b9f22e" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
