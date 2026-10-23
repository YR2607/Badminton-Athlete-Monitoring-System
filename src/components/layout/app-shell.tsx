import Link from "next/link";
import { redirect } from "next/navigation";
import type { Dictionary } from "@/i18n";
import type { AppRole } from "@/lib/types";
import { signOut } from "@/app/actions/auth";
import { NotificationsBell } from "@/components/layout/notifications-bell";

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
      { href: "/coach/alerts", label: d.nav.alerts },
      { href: "/coach/export", label: d.export.title },
    ];
  }
  return [
    { href: "/admin", label: d.nav.home },
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
        <nav className="md:hidden flex gap-1 overflow-x-auto px-3 pb-2">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-foreground/5"
            >
              {i.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
