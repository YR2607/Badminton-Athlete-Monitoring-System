import type { ReactNode } from "react";

/** Uniform page header: title, optional subtitle, right-side actions. */
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
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Uniform empty-state block for lists and sections. */
export function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}
