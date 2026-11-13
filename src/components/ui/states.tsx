import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Screen states — every list/chart/section resolves to one of:
 * data | EmptyState | ErrorState | LoadingSkeleton.
 */

export type EmptyStateKind = "empty" | "insufficient" | "filtered" | "error";

const EMPTY_ICONS: Record<EmptyStateKind, ReactNode> = {
  empty: (
    <path d="M4 5h16v14H4zM4 9h16M9 13h6" />
  ),
  insufficient: (
    <path d="M12 4v16M4 12h16M7 7l10 10M17 7 7 17" opacity=".4" />
  ),
  filtered: (
    <path d="M4 5h16l-6 7v6l-4 2v-8z" />
  ),
  error: (
    <path d="M12 8v5m0 3.5v.5M10.3 3.9 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  ),
};

const EMPTY_TONES: Record<EmptyStateKind, string> = {
  empty: "text-neutral-data",
  insufficient: "text-warn",
  filtered: "text-muted",
  error: "text-danger",
};

/** Full-width empty state with icon, title, hint and optional action. */
export function EmptyState({
  kind = "empty",
  title,
  text,
  action,
  compact = false,
  className,
}: {
  kind?: EmptyStateKind;
  title: string;
  text?: string;
  action?: ReactNode;
  /** Compact = inline strip for cards; default fills a section. */
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5", className)}>
        <svg viewBox="0 0 24 24" className={cn("h-4 w-4 shrink-0", EMPTY_TONES[kind])} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {EMPTY_ICONS[kind]}
        </svg>
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          <span className="font-medium text-foreground">{title}</span>
          {text ? ` — ${text}` : ""}
        </p>
        {action}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center", className)}>
      <svg viewBox="0 0 24 24" className={cn("h-8 w-8", EMPTY_TONES[kind])} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {EMPTY_ICONS[kind]}
      </svg>
      <p className="text-sm font-semibold">{title}</p>
      {text ? <p className="max-w-sm text-xs text-muted">{text}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Error state — same footprint as EmptyState but danger-toned, with retry slot. */
export function ErrorState({
  title,
  text,
  action,
  className,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
}) {
  return <EmptyState kind="error" title={title} text={text} action={action} className={className} />;
}

/** Placeholder block matching real content dimensions. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-foreground/8", className)} />;
}

/** Card-shaped skeleton for loading sections. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3.5" />
        ))}
      </div>
    </div>
  );
}

/** Data coverage meter — visibility into how much data backs a conclusion. */
export function DataCoverageIndicator({
  pct,
  label,
  lowThreshold = 50,
  className,
}: {
  /** 0–100 */
  pct: number;
  label?: string;
  lowThreshold?: number;
  className?: string;
}) {
  const tone = pct >= lowThreshold ? "bg-ok" : "bg-warn";
  return (
    <div className={cn("flex items-center gap-2", className)} title={label}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums", pct >= lowThreshold ? "text-muted" : "font-medium text-warn")}>
        {pct}%{label ? ` · ${label}` : ""}
      </span>
    </div>
  );
}
