"use client";

import { cn } from "@/lib/utils";

/** Mobile-friendly 1..N tap scale with labels at both ends. */
export function ScaleInput({
  value,
  onChange,
  min = 1,
  max = 10,
  lowLabel,
  highLabel,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
}) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${values.length},1fr)` }}>
        {values.map((v) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={selected}
              className={cn(
                "flex min-h-12 items-center justify-center rounded-xl border font-display text-sm font-bold tabular-nums transition-all motion-safe:active:scale-[0.94]",
                selected
                  ? "border-ink bg-ink text-accent shadow-[0_6px_16px_-6px_rgba(22,27,12,0.6)]"
                  : "border-border bg-surface text-foreground/80 hover:border-accent-strong/50 hover:bg-accent/15",
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1.5 flex justify-between text-xs font-medium text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}
