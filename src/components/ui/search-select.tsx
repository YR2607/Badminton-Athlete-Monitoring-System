"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  id: string;
  label: string;
}

/** Searchable dropdown for long option lists (e.g. athlete pickers). */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  searchPlaceholder,
  emptyLabel,
}: {
  options: SearchSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Optional "no selection" entry at the top (e.g. "All athletes"). */
  allLabel?: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-base",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <span className={cn("truncate", !selected && !allLabel && "text-muted")}>
          {selected?.label ?? allLabel ?? placeholder ?? "—"}
        </span>
        <span className="shrink-0 text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {allLabel !== undefined && (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={cn(
                    "block w-full px-3 py-2.5 text-left text-sm hover:bg-foreground/5",
                    value === "" && "font-semibold text-accent",
                  )}
                >
                  {allLabel}
                </button>
              </li>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => pick(o.id)}
                  className={cn(
                    "block w-full px-3 py-2.5 text-left text-sm hover:bg-foreground/5",
                    o.id === value && "font-semibold text-accent",
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted">{emptyLabel}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
