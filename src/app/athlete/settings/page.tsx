import { redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { SettingsForm } from "./settings-form";
import { AthleteCardForm } from "./card-form";
import { ThemeSelect } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";

export default async function SettingsPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));
  const dict = getDictionary(profile.preferred_language);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">{dict.nav.profile}</h1>
      <SettingsForm
        dict={dict}
        profile={profile}
        racketHand={athlete?.racket_hand ?? "right"}
      />
      {athlete && <AthleteCardForm dict={dict} athlete={athlete} />}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="text-sm font-medium">{dict.common.theme}</p>
          <ThemeSelect dict={dict} />
        </CardContent>
      </Card>
    </div>
  );
}
