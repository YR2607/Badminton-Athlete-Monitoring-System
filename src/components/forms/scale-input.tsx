"use client";

import { cn } from "@/lib/utils";

/** Mobile-friendly 1..N tap scale with labels at both ends. */
export function ScaleInput({
  value,
  onChange,
  min = 1,
  max = 5,
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
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
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
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}
