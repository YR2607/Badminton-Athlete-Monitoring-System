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
  LabelList,
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
  /** Unit suffix in tooltips, e.g. "AU" or "/10". */
  unit?: string;
}

/** Horizontal shaded zone (e.g. the ACWR sweet spot). */
export interface Zone {
  y1: number;
  y2: number;
  color: string;
  label?: string;
}

/** "2026-10-24" or "10-24" → "24.10" */
const fmtDate = (v: unknown) => {
  const parts = String(v).split("-");
  return parts.length >= 2 ? `${parts.at(-1)}.${parts.at(-2)}` : String(v);
};

/** Tooltip header: ISO dates get the weekday so a coach reads "пт 24.10". */
const fmtTooltipLabel = (v: unknown) => {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const wd = new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
    return `${wd} ${fmtDate(s)}`;
  }
  return fmtDate(s);
};

/** Fully opaque tooltip — default recharts styling can blend into content below. */
function ChartTooltip({
  active,
  payload,
  label,
  units,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
  units?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="max-w-60 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{fmtTooltipLabel(label)}</p>
      {payload.map((p) => {
        const u = units?.[String(p.dataKey ?? "")] ?? "";
        return (
          <p key={String(p.dataKey ?? p.name)} style={{ color: p.color }}>
            {p.name}: <b className="tabular-nums">{p.value}</b>
            {u ? <span className="text-muted"> {u}</span> : null}
          </p>
        );
      })}
    </div>
  );
}

export function SeriesLineChart({
  data,
  series,
  height = 240,
  domain,
  reference,
  markers,
  band,
  zones,
  connectNulls = false,
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
  /** Bridge gaps between measured points — default false so missing
   *  observations read as gaps, not as smooth continuity. */
  connectNulls?: boolean;
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
        <Tooltip
          content={
            <ChartTooltip
              units={Object.fromEntries(series.map((s) => [s.key, s.unit ?? ""]))}
            />
          }
        />
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
              connectNulls={connectNulls}
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
              connectNulls={connectNulls}
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
  unit = "AU",
}: {
  data: SeriesPoint[];
  height?: number;
  label: string;
  plannedLabel?: string;
  /** Unit suffix shown in the tooltip. */
  unit?: string;
}) {
  if (data.length === 0) return null;
  const hasWave = data.some((d) => d.wave === "peak" || d.wave === "recovery");
  // Fact bar color: BWF wave tag takes visual priority when present; otherwise compare to plan.
  // `state` distinguishes data quality: unknown days render hollow, partial
  // days semi-transparent — a missing record must never look like a calm 0.
  const factColor = (d: SeriesPoint) => {
    if (d.state === "unknown") return "var(--border)";
    const load = typeof d.load === "number" ? d.load : 0;
    const planned = typeof d.planned === "number" ? d.planned : null;
    if (load === 0) return "var(--chart-planned)";
    if (d.wave === "peak") return "var(--danger)";
    if (d.wave === "recovery") return "var(--ok)";
    if (planned === null || planned <= 0) return "var(--accent)";
    if (load <= planned * 1.25) return "var(--ok)";
    if (load <= planned * 1.5) return "var(--warn)";
    return "var(--danger)";
  };
  const factOpacity = (d: SeriesPoint) => {
    if (d.state === "unknown") return 0.35;
    if (d.state === "partial") return 0.45;
    return 1;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: hasWave ? 26 : 8, right: 10, left: 0, bottom: 2 }}
      >
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
        <Tooltip
          content={<ChartTooltip units={{ load: unit, planned: unit }} />}
          cursor={{ fill: "var(--border)", fillOpacity: 0.3 }}
        />
        {plannedLabel ? (
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconSize={10} />
        ) : null}
        {plannedLabel ? (
          <Bar
            dataKey="planned"
            name={plannedLabel}
            fill="var(--chart-planned)"
            fillOpacity={0.35}
            stroke="var(--chart-planned)"
            strokeWidth={1.5}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ) : null}
        <Bar dataKey="load" name={label} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={factColor(d)} fillOpacity={factOpacity(d)} />
          ))}
          {hasWave ? (
            <LabelList
              dataKey="load"
              position="top"
              content={(props) => {
                const { x, y, width, index, value } = props as {
                  x?: number;
                  y?: number;
                  width?: number;
                  index?: number;
                  value?: number;
                };
                if (
                  typeof x !== "number" ||
                  typeof y !== "number" ||
                  typeof width !== "number" ||
                  typeof index !== "number" ||
                  !value
                ) {
                  return null;
                }
                const w = data[index]?.wave;
                if (w !== "peak" && w !== "recovery") return null;
                const cx = x + width / 2;
                const cy = Math.max(12, y - 10);
                const stroke = w === "peak" ? "var(--danger)" : "var(--ok)";
                return (
                  <g>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={11}
                      fill="var(--surface)"
                      stroke={stroke}
                      strokeWidth={2}
                    />
                    <text
                      x={cx}
                      y={cy + 3}
                      textAnchor="middle"
                      fontSize={8.5}
                      fontWeight={700}
                      fill={stroke}
                    >
                      {Math.round(value)}
                    </text>
                  </g>
                );
              }}
            />
          ) : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
