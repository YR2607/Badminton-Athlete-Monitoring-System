import type { Metadata, Viewport } from "next";
import { Sofia_Sans, Sofia_Sans_Condensed } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const sofia = Sofia_Sans({
  variable: "--font-sofia",
  subsets: ["latin", "cyrillic"],
});

const sofiaCond = Sofia_Sans_Condensed({
  variable: "--font-sofia-cond",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RallyMonitor",
  description: "Мониторинг состояния и нагрузки бадминтонистов",
  appleWebApp: {
    capable: true,
    title: "RallyMonitor",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#080d18",
};

/**
 * Direction contract (seed 23e3b5e0 — assigned: athlete-monitoring cockpit, raised).
 * Rendered as a real HTML comment so the production build keeps it for audit.
 */
const DIRECTION_CONTRACT = `<!-- RALLY COCKPIT · seed 23e3b5e0
THESIS: every screen reads as the scoring sheet and the performance board — monumental condensed numerals, hairline-ruled segments, hard status colors; it refuses the light SaaS card grid it replaced.
OWN-WORLD: deep arena navy #080d18 ground, steel hairline #233350, fluoro court-lime #b9f22e as the single action color, Sofia Sans Condensed display numerals over Sofia Sans UI text, segmented-strip controls, tint-on-dark badges.
STORY: the athlete marks a cell like an umpire marks a rally; the coach's first view is a ranked squad board where readiness numerals do the triage.
FIRST VIEWPORT: dark header with condensed wordmark and lime court-corner mark; the stat board — one bordered strip divided into six segments of condensed numerals; below, roster-cell athlete cards (status badge, monumental score, spark, check-in dot row).
FORM: grounded candidate 4 (AMS cockpit) raised by — datamatics: tabular density courage; star atlas: scale-carried hierarchy; character catalog: roster-as-cast cells; metro: type-as-interface, flat fills only.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. -->`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${sofia.variable} ${sofiaCond.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div
          aria-hidden
          className="hidden"
          dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }}
        />
        {children}
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}
