import type { Dictionary } from "@/i18n";

export interface PrevalenceRow {
  zone: string;
  name: string;
  n: number;
  anyPct: number;
  subPct: number;
}

/**
 * OSTRC zone prevalence — paired horizontal bars: % reporting any problem
 * (warn) and % reporting a substantial problem (danger, overlaid darker).
 * Sample size shown per row — percentages without n mislead.
 */
export function PrevalenceBars({
  rows,
  d,
}: {
  rows: PrevalenceRow[];
  d: Dictionary["ostrc"];
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-warn/50" /> {d.anyProblem}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-danger/70" /> {d.substantialCap}
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((z) => (
          <div key={z.zone} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate font-medium sm:w-36" title={z.name}>
              {z.name}
            </span>
            <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-foreground/5">
              <div
                className="absolute inset-y-0 left-0 rounded bg-warn/40"
                style={{ width: `${z.anyPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded bg-danger/70"
                style={{ width: `${z.subPct}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums text-muted">
              {z.anyPct}% · {z.subPct}% · n={z.n}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
