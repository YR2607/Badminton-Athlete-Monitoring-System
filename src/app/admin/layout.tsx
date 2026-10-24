import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { AppShell } from "@/components/layout/app-shell";
import { I18nProvider } from "@/i18n/provider";
import { isFlagEnabled } from "@/lib/flags";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("admin");
  const dict = getDictionary(profile.preferred_language);
  const pushOn = await isFlagEnabled("push", null);
  return (
    <I18nProvider dict={dict} locale={profile.preferred_language}>
      <AppShell role="admin" displayName={profile.display_name} dict={dict} pushEnabled={pushOn}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}
