import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Dictionary } from "@/i18n";
import type { AppRole } from "@/lib/types";
import { signOut } from "@/app/actions/auth";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { BottomNav, type NavItem } from "@/components/layout/bottom-nav";

/** primary — mobile bottom tabs; overflow — inside the "More" sheet */
export function navGroups(role: AppRole, d: Dictionary): { primary: NavItem[]; overflow: NavItem[] } {
  if (role === "athlete") {
    return {
      primary: [
        { href: "/athlete", label: d.nav.home },
        { href: "/athlete/morning", label: d.nav.morning },
        { href: "/athlete/training", label: d.nav.training },
        { href: "/athlete/history", label: d.nav.history },
        { href: "/athlete/settings", label: d.nav.settings },
      ],
      overflow: [],
    };
  }
  if (role === "coach") {
    return {
      primary: [
        { href: "/coach", label: d.nav.athletes },
        { href: "/analytics", label: d.analytics.title },
      ],
      overflow: [
        { href: "/coach/alerts", label: d.nav.alerts },
        { href: "/coach/export", label: d.export.title },
        { href: "/coach/guide", label: d.nav.guide },
      ],
    };
  }
  return {
    primary: [
      { href: "/coach", label: d.nav.athletes },
      { href: "/analytics", label: d.analytics.title },
      { href: "/admin/users", label: d.nav.users },
    ],
    overflow: [
      { href: "/admin", label: d.nav.home },
      { href: "/coach/guide", label: d.nav.guide },
      { href: "/admin/groups", label: d.nav.groups },
      { href: "/admin/rules", label: d.nav.rules },
      { href: "/admin/audit", label: d.nav.audit },
    ],
  };
}

export async function AppShell({
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
  const { primary, overflow } = navGroups(role, dict);
  const items = [...primary, ...overflow];
  const impersonating = (await cookies()).has("rm-impersonating");
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
      {impersonating && (
        <div className="border-b border-accent/30 bg-accent/10">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="truncate">
              {dict.common.impersonatingBanner} <b>{displayName}</b>
            </span>
            <Link
              href="/auth/impersonation-exit"
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            >
              {dict.common.exitImpersonation}
            </Link>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <BottomNav primary={primary} overflow={overflow} moreLabel={dict.nav.more} />
    </div>
  );
}
