import { requireRole, getCurrentAthlete } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { AppShell } from "@/components/layout/app-shell";
import { I18nProvider } from "@/i18n/provider";
import { isFlagEnabled } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";

export default async function AthleteLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("athlete");
  const dict = getDictionary(profile.preferred_language);
  const athlete = await getCurrentAthlete();
  let pushOn = false;
  if (athlete) {
    const supabase = await createClient();
    const { data: memberships } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("athlete_id", athlete.id)
      .is("left_at", null);
    pushOn = await isFlagEnabled("push", (memberships ?? []).map((m) => m.group_id));
  }
  return (
    <I18nProvider dict={dict} locale={profile.preferred_language}>
      <AppShell role="athlete" displayName={profile.display_name} dict={dict} pushEnabled={pushOn}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}
