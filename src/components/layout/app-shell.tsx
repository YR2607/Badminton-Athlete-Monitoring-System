import Link from "next/link";
import { redirect } from "next/navigation";
import type { Dictionary } from "@/i18n";
import type { AppRole } from "@/lib/types";
import { signOut } from "@/app/actions/auth";
import { NotificationsBell } from "@/components/layout/notifications-bell";

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
};

function iconKey(href: string): string {
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
  if (href.includes("analytics")) return "analytics";
  return "home";
}

export function navItems(role: AppRole, d: Dictionary): { href: string; label: string }[] {
  if (role === "athlete") {
    return [
      { href: "/athlete", label: d.nav.home },
      { href: "/athlete/morning", label: d.nav.morning },
      { href: "/athlete/training", label: d.nav.training },
      { href: "/athlete/history", label: d.nav.history },
      { href: "/athlete/settings", label: d.nav.settings },
    ];
  }
  if (role === "coach") {
    return [
      { href: "/coach", label: d.nav.home },
      { href: "/analytics", label: d.analytics.title },
      { href: "/coach/alerts", label: d.nav.alerts },
      { href: "/coach/export", label: d.export.title },
    ];
  }
  return [
    { href: "/admin", label: d.nav.home },
    { href: "/analytics", label: d.analytics.title },
    { href: "/admin/users", label: d.nav.users },
    { href: "/admin/groups", label: d.nav.groups },
    { href: "/admin/rules", label: d.nav.rules },
    { href: "/admin/audit", label: d.nav.audit },
  ];
}

export function AppShell({
  role,
  displayName,
  dict,
  children,
}: {
  role: AppRole;
  displayName: string;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const items = navItems(role, dict);
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="font-bold tracking-tight">
            {dict.app.name}
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-foreground/5 hover:text-foreground"
              >
                {i.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NotificationsBell />
            <span className="hidden sm:block text-sm text-muted">{displayName}</span>
            <form
              action={async () => {
                "use server";
                await signOut();
                redirect("/login");
              }}
            >
              <button className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-foreground/5 hover:text-foreground">
                {dict.common.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-muted active:text-accent"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={ICONS[iconKey(i.href)]} />
              </svg>
              <span className="max-w-full truncate px-1 text-[10px] leading-tight">{i.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
