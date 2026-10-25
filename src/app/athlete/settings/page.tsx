import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.nav.settings}</h1>
      <SettingsForm dict={dict} profile={profile} />
    </div>
  );
}
