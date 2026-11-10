import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { Card, CardContent } from "@/components/ui/card";

/** Configuration hub — entry point to the four system-config sections. */
export default async function AdminConfigPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);

  const sections: { href: string; label: string }[] = [
    { href: "/admin/features", label: dict.nav.features },
    { href: "/admin/rules", label: dict.nav.rules },
    { href: "/admin/ostrc", label: dict.tests.ostrcZones },
    { href: "/admin/tests", label: dict.nav.tests },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{dict.nav.configuration}</h1>
        <p className="text-sm text-muted">{dict.admin.dash.configHubHint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full transition-colors hover:border-accent/50">
              <CardContent className="flex items-center justify-between pt-4 font-medium">
                {s.label}
                <span className="text-muted">→</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
