import ru, { type Dictionary } from "./ru";
import en from "./en";
import ro from "./ro";
import type { Locale } from "@/lib/types";

export type { Dictionary };
export const locales: Locale[] = ["ru", "ro", "en"];
export const defaultLocale: Locale = "ru";

export function getDictionary(locale: string | null | undefined): Dictionary {
  if (locale === "en") return en;
  if (locale === "ro") return ro;
  return ru;
}
