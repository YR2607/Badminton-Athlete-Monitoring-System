import type { ReactNode } from "react";

export { KPIStat as StatCard } from "./kpi-stat";
export { EmptyState } from "./states";

/** Uniform page header: 28px title, optional subtitle, right-side actions. */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
