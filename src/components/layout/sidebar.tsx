"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isActive, NavIcon, type NavItem } from "@/components/layout/bottom-nav";
import { cn } from "@/lib/utils";

const COOKIE_KEY = "rm-nav-collapsed";

function Item({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-accent/10 font-semibold text-accent"
          : "text-muted hover:bg-foreground/5 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <NavIcon href={item.href} className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** Collapsible desktop sidebar: primary nav + secondary section. */
export function Sidebar({
  primary,
  overflow,
  moreLabel,
  brand,
  collapseLabel,
  expandLabel,
  defaultCollapsed = false,
}: {
  primary: NavItem[];
  overflow: NavItem[];
  moreLabel: string;
  brand: string;
  collapseLabel: string;
  expandLabel: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      // Persist via cookie — readable server-side, no hydration mismatch.
      document.cookie = `${COOKIE_KEY}=${c ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface md:flex",
        collapsed ? "w-[68px]" : "w-60",
        "transition-[width] duration-200",
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center px-0" : "px-5")}>
        <Link href="/" className="truncate font-bold tracking-tight">
          {collapsed ? brand.slice(0, 1) : brand}
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
        {primary.map((i) => (
          <Item key={i.href} item={i} collapsed={collapsed} />
        ))}
        {overflow.length > 0 && (
          <>
            <div className={cn("pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted/70", collapsed ? "text-center" : "px-3")}>
              {collapsed ? "·" : moreLabel}
            </div>
            {overflow.map((i) => (
              <Item key={i.href} item={i} collapsed={collapsed} />
            ))}
          </>
        )}
      </nav>
      <div className="border-t border-border p-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? expandLabel : collapseLabel}
          title={collapsed ? expandLabel : collapseLabel}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-foreground/5 hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span className="truncate">{collapseLabel}</span>}
        </button>
      </div>
    </aside>
  );
}
