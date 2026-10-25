"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/i18n";

type Theme = "light" | "dark" | "system";

const META_COLORS = { light: "#2563eb", dark: "#080d18" } as const;

const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(t: Theme): "light" | "dark" {
  return t === "system" ? (isDark() ? "dark" : "light") : t;
}

function storedTheme(): Theme {
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
}

// --- tiny external store: theme pref + resolved theme, shared across components
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const m = matchMedia("(prefers-color-scheme: dark)");
  m.addEventListener("change", cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    m.removeEventListener("change", cb);
    window.removeEventListener("storage", cb);
  };
}

function apply(t: Theme) {
  const resolved = resolve(t);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", META_COLORS[resolved]);
  localStorage.setItem("theme", t);
  listeners.forEach((cb) => cb());
}

function useThemePref(): Theme {
  return useSyncExternalStore(subscribe, storedTheme, () => "system" as Theme);
}

function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, () => resolve(storedTheme()), () => "light");
}

/** Compact header toggle — flips between light and dark. */
export function ThemeToggle({ label }: { label: string }) {
  const resolved = useResolvedTheme();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => apply(resolved === "dark" ? "light" : "dark")}
      className="rounded-lg p-2 text-muted hover:bg-foreground/5 hover:text-foreground"
    >
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** Settings row — system / light / dark segmented control. */
export function ThemeSelect({ dict }: { dict: Dictionary }) {
  const theme = useThemePref();
  const options: { value: Theme; label: string }[] = [
    { value: "system", label: dict.common.themeSystem },
    { value: "light", label: dict.common.themeLight },
    { value: "dark", label: dict.common.themeDark },
  ];
  return (
    <div className="flex rounded-xl border border-border p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => apply(o.value)}
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            theme === o.value
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
