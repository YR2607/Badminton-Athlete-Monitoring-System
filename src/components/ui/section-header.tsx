import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Section header: 19–22px title + optional hint + right-side actions. */
export function SectionHeader({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Breadcrumbs: Dashboard / Athletes / Ivan P. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-xs text-muted", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="hover:text-foreground hover:underline">
                {it.label}
              </Link>
            ) : (
              <span className={i === items.length - 1 ? "font-medium text-foreground" : ""} aria-current={i === items.length - 1 ? "page" : undefined}>
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
