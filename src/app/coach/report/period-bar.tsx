"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n";

/** Inline period + custom date range bar for report and athlete pages. */
export function PeriodBar({
  baseHref,
  period,
  from,
  to,
  d,
}: {
  /** URL prefix including static query params, e.g. `/coach/report?athlete=123` */
  baseHref: string;
  period: string;
  from: string;
  to: string;
  d: Dictionary["report"];
}) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const sep = baseHref.includes("?") ? "&" : "?";

  const presets: { key: string; label: string }[] = [
    { key: "7d", label: d.p7d },
    { key: "month", label: d.pMonth },
    { key: "30d", label: d.p30d },
  ];

  const applyCustom = () => {
    if (!f || !t) return;
    router.push(`${baseHref}${sep}period=custom&from=${f}&to=${t}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs print:hidden">
      {presets.map((p) => (
        <a
          key={p.key}
          href={`${baseHref}${sep}period=${p.key}`}
          className={`rounded-lg border px-2.5 py-1.5 font-medium ${
            period === p.key ? "border-accent bg-accent/10 text-accent" : "border-border"
          }`}
        >
          {p.label}
        </a>
      ))}
      <div className="flex min-w-0 basis-full items-center gap-1 sm:basis-auto">
        <input
          type="date"
          value={f}
          onChange={(e) => setF(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs sm:w-28 sm:flex-none"
        />
        <span className="shrink-0 text-muted">→</span>
        <input
          type="date"
          value={t}
          onChange={(e) => setT(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs sm:w-28 sm:flex-none"
        />
        <button
          type="button"
          onClick={applyCustom}
          className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 font-medium text-white"
        >
          {d.applyDates}
        </button>
      </div>
    </div>
  );
}
