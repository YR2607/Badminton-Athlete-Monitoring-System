import Link from "next/link";
import type { Dictionary } from "@/i18n";

export interface QuadrantPoint {
  id: string;
  name: string;
  load: number; // 7-day AU
  readiness: number; // 0..100
  hasPain: boolean;
  isToday: boolean;
}

/**
 * 2D Load × Readiness quadrant (Kitman / Smartabase style).
 * X = 7-day sRPE load (AU), split at group median (or 1500 AU fallback).
 * Y = readiness 0..100, split at 65 (good/moderate boundary).
 */
export function LoadReadinessQuadrant({
  points,
  dict,
}: {
  points: QuadrantPoint[];
  dict: Dictionary;
}) {
  const d = dict.coach;
  if (points.length === 0) {
    return <p className="text-sm text-muted">{dict.common.noData}</p>;
  }

  const loads = points.map((p) => p.load).sort((a, b) => a - b);
  const maxLoad = Math.max(2000, ...(loads.length ? [loads[loads.length - 1] * 1.15] : [2000]));
  const midLoad =
    loads.length >= 2 && loads[loads.length - 1] > 0
      ? Math.max(400, Math.round(loads[Math.floor(loads.length / 2)]))
      : Math.round(maxLoad / 2);
  const splitX = Math.min(82, Math.max(22, (midLoad / maxLoad) * 100));
  const splitY = 35; // 100 - 65 = 35% from top

  return (
    <div className="space-y-3">
      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-border bg-surface">
        {/* 4 semantic quadrants */}
        <div
          className="absolute top-0 left-0 bg-accent/5"
          style={{ width: `${splitX}%`, height: `${splitY}%` }}
          title={d.quadrantZoneFresh}
        />
        <div
          className="absolute top-0 right-0 bg-ok/10"
          style={{ width: `${100 - splitX}%`, height: `${splitY}%` }}
          title={d.quadrantZonePeak}
        />
        <div
          className="absolute bottom-0 left-0 bg-warn/8"
          style={{ width: `${splitX}%`, height: `${100 - splitY}%` }}
          title={d.quadrantZoneLow}
        />
        <div
          className="absolute right-0 bottom-0 bg-danger/12"
          style={{ width: `${100 - splitX}%`, height: `${100 - splitY}%` }}
          title={d.quadrantZoneOverreach}
        />

        {/* Hairline split axes */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-border"
          style={{ left: `${splitX}%` }}
        />
        <div
          className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-border"
          style={{ top: `${splitY}%` }}
        />

        {/* Corner zone captions */}
        <span className="pointer-events-none absolute top-2 left-2.5 text-[11px] font-medium text-muted">
          {d.quadrantZoneFresh}
        </span>
        <span className="pointer-events-none absolute top-2 right-2.5 text-right text-[11px] font-medium text-ok">
          {d.quadrantZonePeak}
        </span>
        <span className="pointer-events-none absolute bottom-5 left-2.5 text-[11px] font-medium text-warn">
          {d.quadrantZoneLow}
        </span>
        <span className="pointer-events-none absolute right-2.5 bottom-5 text-right text-[11px] font-medium text-danger">
          {d.quadrantZoneOverreach}
        </span>

        {/* Axis labels */}
        <span className="pointer-events-none absolute right-2.5 bottom-1 text-[10px] text-muted">
          {d.quadrantLoadAxis} →
        </span>
        <span className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-muted">
          ↑ {d.quadrantReadinessAxis} (65)
        </span>

        {/* Athlete markers */}
        {points.map((p) => {
          const xPct = Math.min(94, Math.max(6, (p.load / maxLoad) * 88 + 6));
          const yPct = Math.min(90, Math.max(10, 100 - (p.readiness / 100) * 80 - 10));
          const danger = p.hasPain || (p.load >= midLoad && p.readiness < 65);
          const good = !p.hasPain && p.readiness >= 65;
          const dotCls = danger
            ? "bg-danger text-danger-foreground ring-danger/40"
            : good
              ? "bg-ok text-white ring-ok/40"
              : "bg-warn text-white ring-warn/40";
          return (
            <Link
              key={p.id}
              href={`/coach/athletes/${p.id}`}
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
              title={`${p.name} · ${d.quadrantReadinessAxis}: ${Math.round(p.readiness)} · ${d.quadrantLoadAxis}: ${p.load}`}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
            >
              <span className="flex items-center gap-1 rounded-full border border-border bg-surface/95 px-2 py-0.5 text-xs font-medium shadow-sm transition-transform group-hover:scale-110">
                <span className={`h-2.5 w-2.5 rounded-full ring-2 ${dotCls}`} />
                <span className="max-w-24 truncate">{p.name}</span>
                <span className="text-[10px] text-muted tabular-nums">
                  {Math.round(p.readiness)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
