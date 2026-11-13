import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared visualization primitives — keep every chart framed the same way:
 * titled card + hint + optional interpretation line + consistent empty state.
 */

/** Uniform empty state: dashed well matching a chart's height. */
export function EmptyChart({ text, height = 160 }: { text: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted"
      style={{ height }}
    >
      {text}
    </div>
  );
}

const TONES = {
  neutral: "border-border/60 bg-foreground/[0.03] text-muted",
  ok: "border-ok/30 bg-ok/5 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
} as const;

/** One-line deterministic interpretation under a chart — never invented data. */
export function InsightLine({
  tone = "neutral",
  right,
  children,
}: {
  tone?: keyof typeof TONES;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs",
        TONES[tone],
      )}
    >
      <span className="font-medium">{children}</span>
      {right ? <span className="text-muted">{right}</span> : null}
    </div>
  );
}

/** KPI tile: value + label + optional delta chip + hint on hover. */
export function StatCard({
  label,
  value,
  hint,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  return (
    <div
      title={hint}
      className={cn(
        "rounded-xl border p-3",
        tone === "neutral" ? "border-border" : TONES[tone],
      )}
    >
      <p className="text-lg font-bold tabular-nums">
        {value} {delta}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
