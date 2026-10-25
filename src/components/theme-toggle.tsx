"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/i18n";

type Theme = "light" | "dark" | "system";

const META_COLORS = { light: "#2563eb", dark: "#080d18" } as const;

function resolve(t: Theme): "light" | "dark" {
  if (t === "system") {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

function apply(t: Theme) {
  const resolved = resolve(t);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", META_COLORS[resolved]);
  localStorage.setItem("theme", t);
}

function currentTheme(): Theme {
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
}

/** Compact header toggle — flips between light and dark. */
export function ThemeToggle({ label }: { label: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (currentTheme() === "system") setDark(mq.matches), apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = dark ? "light" : "dark";
        setDark(!dark);
        apply(next);
      }}
      className="rounded-lg p-2 text-muted hover:bg-foreground/5 hover:text-foreground"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** Settings row — system / light / dark segmented control. */
export function ThemeSelect({ dict }: { dict: Dictionary }) {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    setTheme(currentTheme());
  }, []);
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
          onClick={() => {
            setTheme(o.value);
            apply(o.value);
          }}
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
