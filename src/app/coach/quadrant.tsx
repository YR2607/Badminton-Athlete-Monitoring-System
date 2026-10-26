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
 * Zone captions live in a clean 2×2 legend below so mobile screens never clip
 * or overlap text inside the plot; nearby points are nudged apart.
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
  const splitX = Math.min(78, Math.max(26, (midLoad / maxLoad) * 100));
  const splitY = 35; // 100 - 65 = 35% from top

  // Compute initial positions and nudge colliding pills apart so names never overlap.
  const placed: { p: QuadrantPoint; x: number; y: number }[] = [];
  for (const p of points) {
    let x = Math.min(88, Math.max(12, (p.load / maxLoad) * 76 + 12));
    let y = Math.min(88, Math.max(12, 100 - (p.readiness / 100) * 76 - 12));
    for (let attempt = 0; attempt < 6; attempt++) {
      const hit = placed.find(
        (q) => Math.abs(q.x - x) < 18 && Math.abs(q.y - y) < 11,
      );
      if (!hit) break;
      const dir = attempt % 2 === 0 ? 1 : -1;
      y = Math.min(90, Math.max(10, y + dir * 11));
      x = Math.min(90, Math.max(10, x + (attempt >= 2 ? 8 : 0)));
    }
    placed.push({ p, x, y });
  }

  return (
    <div className="space-y-2.5">
      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-border bg-surface">
        {/* 4 semantic quadrants */}
        <div
          className="absolute top-0 left-0 bg-accent/5"
          style={{ width: `${splitX}%`, height: `${splitY}%` }}
        />
        <div
          className="absolute top-0 right-0 bg-ok/10"
          style={{ width: `${100 - splitX}%`, height: `${splitY}%` }}
        />
        <div
          className="absolute bottom-0 left-0 bg-warn/8"
          style={{ width: `${splitX}%`, height: `${100 - splitY}%` }}
        />
        <div
          className="absolute right-0 bottom-0 bg-danger/12"
          style={{ width: `${100 - splitX}%`, height: `${100 - splitY}%` }}
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

        {/* Compact axis badges (never collide with athlete pills) */}
        <span className="pointer-events-none absolute top-1.5 left-2 rounded bg-surface/80 px-1.5 py-0.5 text-[10px] text-muted">
          ↑ {d.quadrantReadinessAxis} · 65
        </span>
        <span className="pointer-events-none absolute right-2 bottom-1.5 rounded bg-surface/80 px-1.5 py-0.5 text-[10px] text-muted">
          {d.quadrantLoadAxis} →
        </span>

        {/* Athlete markers */}
        {placed.map(({ p, x, y }) => {
          const danger = p.hasPain || (p.load >= midLoad && p.readiness < 65);
          const good = !p.hasPain && p.readiness >= 65;
          const dotCls = danger
            ? "bg-danger ring-danger/40"
            : good
              ? "bg-ok ring-ok/40"
              : "bg-warn ring-warn/40";
          return (
            <Link
              key={p.id}
              href={`/coach/athletes/${p.id}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${p.name} · ${d.quadrantReadinessAxis}: ${Math.round(p.readiness)} · ${d.quadrantLoadAxis}: ${p.load}`}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
            >
              <span className="flex items-center gap-1 rounded-full border border-border bg-surface/95 px-2 py-0.5 text-[11px] font-medium shadow-sm transition-transform group-hover:scale-110">
                <span className={`h-2 w-2 shrink-0 rounded-full ring-2 ${dotCls}`} />
                <span className="max-w-20 truncate sm:max-w-28">{p.name}</span>
                <span className="text-[10px] text-muted tabular-nums">
                  {Math.round(p.readiness)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* Clean 2×2 legend below — readable on any phone width */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-accent/5 px-2 py-1 text-muted">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          <span className="truncate">{d.quadrantZoneFresh}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok/10 px-2 py-1 text-ok">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
          <span className="truncate">{d.quadrantZonePeak}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/8 px-2 py-1 text-warn">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
          <span className="truncate">{d.quadrantZoneLow}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/12 px-2 py-1 text-danger">
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <span className="truncate">{d.quadrantZoneOverreach}</span>
        </div>
      </div>
    </div>
  );
}
