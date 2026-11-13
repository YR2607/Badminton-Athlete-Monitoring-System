import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "border-border bg-surface",
  ok: "border-ok/30 bg-ok/5",
  warn: "border-warn/40 bg-warn/5",
  danger: "border-danger/40 bg-danger/5",
  accent: "border-accent/40 bg-accent/5",
} as const;

const VALUE_TONES = {
  neutral: "",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
} as const;

export type KpiTone = keyof typeof TONES;

/**
 * KPI tile — label + big tabular value + optional delta/context.
 * `sub` adds a second small line (period, sample size, hint).
 */
export function KPIStat({
  label,
  value,
  sub,
  hint,
  delta,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  /** Secondary caption under the label (period, n=, etc). */
  sub?: ReactNode;
  /** Tooltip explaining the metric. */
  hint?: string;
  delta?: ReactNode;
  tone?: KpiTone;
  className?: string;
}) {
  return (
    <div title={hint} className={cn("rounded-xl border p-3", TONES[tone], className)}>
      <p className={cn("text-lg font-bold tabular-nums", VALUE_TONES[tone])}>
        {value} {delta}
      </p>
      <p className="text-xs text-muted">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted/80">{sub}</p> : null}
    </div>
  );
}
