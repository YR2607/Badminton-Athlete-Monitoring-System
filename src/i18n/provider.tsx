"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "./index";
import type { Locale } from "@/lib/types";

const DictContext = createContext<Dictionary | null>(null);
const LocaleContext = createContext<Locale>("ru");

export function I18nProvider({
  dict,
  locale,
  children,
}: {
  dict: Dictionary;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <DictContext.Provider value={dict}>{children}</DictContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useDict(): Dictionary {
  const d = useContext(DictContext);
  if (!d) throw new Error("useDict must be used inside I18nProvider");
  return d;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
