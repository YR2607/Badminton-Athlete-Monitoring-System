import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

export const metadata: Metadata = {
  title: "RallyMonitor",
  description: "Мониторинг состояния и нагрузки бадминтонистов",
  appleWebApp: {
    capable: true,
    title: "RallyMonitor",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#161b0c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
