"use client";

import { cn } from "@/lib/utils";

/**
 * The scoring strip: a 1..N tap scale rendered as one ruled row of cells —
 * the athlete marks a cell the way an umpire crosses a rally point.
 */
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
      <div
        role="radiogroup"
        className="grid overflow-hidden rounded-lg border border-border bg-field"
        style={{ gridTemplateColumns: `repeat(${values.length},1fr)` }}
      >
        {values.map((v, i) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "score-num flex min-h-12 items-center justify-center text-base font-semibold transition-colors",
              i > 0 && "border-l border-border",
              value === v
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1.5 flex justify-between text-xs text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}
