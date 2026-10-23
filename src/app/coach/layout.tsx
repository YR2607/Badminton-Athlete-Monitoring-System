import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { AppShell } from "@/components/layout/app-shell";
import { I18nProvider } from "@/i18n/provider";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["coach", "admin"]);
  const dict = getDictionary(profile.preferred_language);
  return (
    <I18nProvider dict={dict} locale={profile.preferred_language}>
      <AppShell role={profile.role === "admin" ? "admin" : "coach"} displayName={profile.display_name} dict={dict}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}
