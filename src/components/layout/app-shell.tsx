import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Dictionary } from "@/i18n";
import type { AppRole } from "@/lib/types";
import { exitImpersonation, signOut } from "@/app/actions/auth";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav, type NavItem } from "@/components/layout/bottom-nav";
import { PushSubscribe } from "@/components/push-subscribe";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopProgress } from "@/components/layout/top-progress";

/** primary — main nav; overflow — secondary section. */
export function navGroups(role: AppRole, d: Dictionary, isAdmin = false): { primary: NavItem[]; overflow: NavItem[] } {
  if (role === "athlete") {
    return {
      primary: [
        { href: "/athlete", label: d.nav.home },
        { href: "/athlete/morning", label: d.nav.morning },
        { href: "/athlete/training", label: d.nav.training },
        { href: "/athlete/academy", label: d.nav.academy },
        { href: "/athlete/tournaments", label: d.nav.tournaments },
      ],
      overflow: [
        { href: "/athlete/history", label: d.nav.history },
        { href: "/athlete/settings", label: d.nav.profile },
      ],
    };
  }
  if (role === "coach") {
    // Primary = daily decisions; secondary tools live in "More".
    return {
      primary: [
        { href: "/coach", label: d.nav.today },
        { href: "/coach/athletes", label: d.nav.athletes },
        { href: "/analytics", label: d.analytics.title },
        { href: "/coach/report", label: d.nav.reports },
        { href: "/coach/attendance", label: d.nav.attendance },
      ],
      overflow: [
        { href: "/coach/alerts", label: d.nav.alerts },
        { href: "/coach/academy", label: d.nav.academy },
        { href: "/coach/tests", label: d.nav.tests },
        { href: "/coach/tournaments", label: d.nav.tournaments },
        { href: "/coach/guide", label: d.nav.guide },
        ...(isAdmin ? [{ href: "/admin", label: d.nav.adminWorkspace }] : []),
      ],
    };
  }
  // Admin workspace: club management first, coach workspace one tap away.
  return {
    primary: [
      { href: "/admin", label: d.nav.overview },
      { href: "/admin/users", label: d.nav.users },
      { href: "/admin/groups", label: d.nav.groups },
      { href: "/analytics", label: d.analytics.title },
      { href: "/admin/config", label: d.nav.configuration },
    ],
    overflow: [
      { href: "/admin/audit", label: d.nav.audit },
      { href: "/coach", label: d.nav.coachWorkspace },
      { href: "/coach/tournaments", label: d.nav.tournaments },
      { href: "/coach/report", label: d.nav.reports },
      { href: "/coach/guide", label: d.nav.guide },
    ],
  };
}

export async function AppShell({
  role,
  displayName,
  dict,
  pushEnabled = false,
  isAdmin = false,
  children,
}: {
  role: AppRole;
  displayName: string;
  dict: Dictionary;
  /** Mounts the push opt-in banner + SW registration (flag 'push'). */
  pushEnabled?: boolean;
  /** Admin viewing the coach workspace gets a way back to /admin. */
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const { primary, overflow } = navGroups(role, dict, isAdmin);
  const cookieStore = await cookies();
  const impersonating = cookieStore.has("rm-impersonating");
  const navCollapsed = cookieStore.get("rm-nav-collapsed")?.value === "1";
  return (
    <div className="min-h-full">
      <TopProgress />
      <div className="flex min-h-screen">
        <Sidebar
          primary={primary}
          overflow={overflow}
          moreLabel={dict.nav.more}
          brand={dict.app.name}
          collapseLabel={dict.nav.collapse}
          expandLabel={dict.nav.expand}
          defaultCollapsed={navCollapsed}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
            <div className="flex h-14 items-center gap-3 px-4 md:px-8">
              <Link href="/" className="font-bold tracking-tight md:hidden">
                {dict.app.name}
              </Link>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle label={dict.common.theme} />
                <NotificationsBell />
                <span className="hidden text-sm text-muted sm:block">{displayName}</span>
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
              <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm md:px-8">
                <span className="truncate">
                  {dict.common.impersonatingBanner} <b>{displayName}</b>
                </span>
                <form action={exitImpersonation}>
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
                  >
                    {dict.common.exitImpersonation}
                  </button>
                </form>
              </div>
            </div>
          )}
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 pb-28 md:px-8 md:pb-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <BottomNav primary={primary} overflow={overflow} moreLabel={dict.nav.more} />
      {pushEnabled && <PushSubscribe dict={dict} />}
    </div>
  );
}
