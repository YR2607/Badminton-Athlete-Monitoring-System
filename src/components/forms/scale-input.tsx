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
  // On narrow phones 10–11 buttons in one row squeeze to ~21px; split into two
  // comfortable tap rows on mobile and a single row from sm: upwards.
  const gridCols =
    values.length === 11
      ? "grid-cols-6 sm:grid-cols-11"
      : values.length === 10
        ? "grid-cols-5 sm:grid-cols-10"
        : "grid-cols-5";
  return (
    <div>
      <div className={cn("grid gap-1.5", gridCols)}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors",
              value === v
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface hover:bg-foreground/5",
            )}
          >
            {v}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1.5 flex justify-between gap-3 text-xs text-muted">
          <span>{min} — {lowLabel}</span>
          <span className="text-right">{max} — {highLabel}</span>
        </div>
      )}
    </div>
  );
}
