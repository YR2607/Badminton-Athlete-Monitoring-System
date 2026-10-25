"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { isActive, type NavItem } from "@/components/layout/bottom-nav";

/** Desktop overflow: secondary nav items behind a hamburger menu. */
export function NavOverflow({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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

  // Close on navigation
  useEffect(() => setOpen(false), [pathname]);

  if (items.length === 0) return null;
  const hasActive = items.some((i) => isActive(pathname, i.href));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${
          hasActive ? "text-foreground" : "text-muted"
        } hover:bg-foreground/5 hover:text-foreground`}
      >
        <Menu size={16} />
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`block rounded-lg px-3 py-2 text-sm ${
                isActive(pathname, i.href)
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-foreground hover:bg-foreground/5"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
