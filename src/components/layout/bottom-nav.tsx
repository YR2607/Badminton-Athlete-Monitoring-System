"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string };

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  morning: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4",
  training: "M4 9v6h2v3h2V6H6v3zm14 0v6h-2v3h-2V6h2v3zM10 11h4v2h-4z",
  history: "M12 5a7 7 0 1 1-6.32 4M5 4v5h5M12 9v4l3 2",
  alerts: "M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0",
  users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6M2 20c0-3 3-5 6-5s6 2 6 5m2-5c3 0 6 2 6 5",
  groups: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  rules: "M12 3v18M5 7h14M7 7l-3 6a3.5 3.5 0 0 0 7 0L8 7m9 0-3 6a3.5 3.5 0 0 0 7 0l-3-6",
  audit: "M8 3h8l4 4v14H8zM12 11v5M9 16h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4h-2m-4-8V2m-4 2v2M4 12h2m4 8v-2m-6.4-9.4 1.4 1.4m9.2 9.2 1.4 1.4m0-12-1.4 1.4M4.6 18.6 6 17.2",
  export: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v4h16v-4",
  analytics: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  academy: "M22 9 12 4 2 9l10 5 10-5zM6 11.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-4.5M22 9v6",
  attendance: "M8 3h8l3 3v15H5V6zM9 13l2 2 4-4M9 4v4h6V4",
  features: "M4 6h4v4H4zM4 14h4v4H4zM12 6h8M12 10h8M12 14h8M12 18h8",
  more: "M5 6h14M5 12h14M5 18h14",
};

export function iconKey(href: string): string {
  // Coach/admin home tab is labeled "Athletes" — show the people icon, not a house.
  if (href === "/coach") return "users";
  if (href.includes("morning")) return "morning";
  if (href.includes("training")) return "training";
  if (href.includes("history")) return "history";
  if (href.includes("alerts")) return "alerts";
  if (href.includes("users")) return "users";
  if (href.includes("groups")) return "groups";
  if (href.includes("rules")) return "rules";
  if (href.includes("audit")) return "audit";
  if (href.includes("settings")) return "settings";
  if (href.includes("export")) return "export";
  if (href.includes("features")) return "features";
  if (href.includes("analytics")) return "analytics";
  if (href.includes("academy")) return "academy";
  if (href.includes("attendance")) return "attendance";
  return "home";
}

function NavIcon({ href, className }: { href: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[iconKey(href)]} />
    </svg>
  );
}

export function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // /coach also matches athlete profile pages, but not sibling sections
  if (href === "/coach") return pathname.startsWith("/coach/athletes");
  return pathname.startsWith(href + "/");
}

/** Mobile bottom tab bar: primary items + a "More" sheet for the rest. */
export function BottomNav({
  primary,
  overflow,
  moreLabel,
}: {
  primary: NavItem[];
  overflow: NavItem[];
  moreLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-border bg-surface/95 shadow-lg backdrop-blur md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      >
        <div className="flex">
          {primary.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 ${
                isActive(pathname, i.href) ? "text-accent" : "text-muted"
              }`}
            >
              <NavIcon href={i.href} />
              <span className="max-w-full truncate px-1 text-[10px] leading-tight">{i.label}</span>
            </Link>
          ))}
          {overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-muted"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d={ICONS.more} />
              </svg>
              <span className="max-w-full truncate px-1 text-[10px] leading-tight">{moreLabel}</span>
            </button>
          )}
        </div>
      </nav>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-2 pb-6 md:hidden">
            {overflow.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] ${
                  isActive(pathname, i.href) ? "bg-accent/10 text-accent" : "text-foreground"
                }`}
              >
                <NavIcon href={i.href} className="h-5 w-5 text-muted" />
                {i.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
