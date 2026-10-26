"use client";

import { cn } from "@/lib/utils";

export interface ScaleHints {
  good: string;
  mid: string;
  bad: string;
}

/**
 * Mobile-friendly 1..N tap scale with traffic-light semantics:
 *  - inverted=false (sleep, recovery, mood, feeling): higher = green (good), lower = red
 *  - inverted=true  (fatigue, soreness, stress, pain): lower = green (good), higher = red
 * When a teenager taps 8 on an inverted scale thinking "8 = good", the button
 * turns red and a clear banner below explains what 8 means and which end is "good".
 */
export function ScaleInput({
  value,
  onChange,
  min = 1,
  max = 10,
  lowLabel,
  highLabel,
  inverted = false,
  hints,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  inverted?: boolean;
  hints?: ScaleHints;
}) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const gridCols =
    values.length === 11
      ? "grid-cols-6 sm:grid-cols-11"
      : values.length === 10
        ? "grid-cols-5 sm:grid-cols-10"
        : "grid-cols-5";

  // Normalized goodness 1..10 so traffic-light colors match the readiness formula.
  const goodness =
    value === undefined
      ? null
      : inverted
        ? max - value + min
        : value - min + 1;
  const band: "good" | "mid" | "bad" | null =
    goodness === null ? null : goodness >= 7 ? "good" : goodness >= 4 ? "mid" : "bad";

  const activeCls =
    band === "good"
      ? "border-ok bg-ok text-white"
      : band === "mid"
        ? "border-warn bg-warn text-white"
        : band === "bad"
          ? "border-danger bg-danger text-danger-foreground"
          : "border-accent bg-accent text-accent-foreground";

  const hintText = (() => {
    if (value === undefined || !hints || !lowLabel || !highLabel) return null;
    if (band === "good") {
      return hints.good.replace("{edge}", inverted ? lowLabel : highLabel);
    }
    if (band === "mid") {
      return hints.mid.replace("{low}", lowLabel).replace("{high}", highLabel);
    }
    return hints.bad
      .replace("{edge}", inverted ? highLabel : lowLabel)
      .replace("{good}", inverted ? `${min}–3` : `7–${max}`);
  })();

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
                ? activeCls
                : "border-border bg-surface hover:bg-foreground/5",
            )}
          >
            {v}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                inverted ? "bg-ok" : "bg-danger",
              )}
            />
            <span>
              {min} — {lowLabel}
            </span>
          </span>
          <span className="flex items-center gap-1 text-right">
            <span>
              {max} — {highLabel}
            </span>
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                inverted ? "bg-danger" : "bg-ok",
              )}
            />
          </span>
        </div>
      )}
      {hintText && (
        <p
          className={cn(
            "mt-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
            band === "good"
              ? "border-ok/30 bg-ok/10 text-ok"
              : band === "mid"
                ? "border-warn/30 bg-warn/10 text-warn"
                : "border-danger/40 bg-danger/10 text-danger",
          )}
        >
          <b>
            {value}/{max}
          </b>{" "}
          — {hintText}
        </p>
      )}
    </div>
  );
}
