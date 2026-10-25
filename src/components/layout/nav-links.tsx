"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavItem } from "@/components/layout/bottom-nav";
import { cn } from "@/lib/utils";

/** Desktop primary nav — muted links with a clear active state. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((i) => {
        const active = isActive(pathname, i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors hover:bg-foreground/5 hover:text-foreground",
              active ? "bg-accent/10 font-medium text-accent" : "text-muted",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </>
  );
}
