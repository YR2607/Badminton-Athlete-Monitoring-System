import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

export default async function AdminHome() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();

  const [{ count: users }, { count: athletes }, { count: groups }, { count: openAlerts }] =
    await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("athletes").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("groups").select("id", { count: "exact", head: true }),
      supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);

  const tiles = [
    [dict.admin.users, users ?? 0, "/admin/users"],
    [dict.nav.athletes, athletes ?? 0, "/coach"],
    [dict.nav.groups, groups ?? 0, "/admin/groups"],
    [dict.alerts.open, openAlerts ?? 0, "/coach/alerts"],
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.admin.title}</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, v, href]) => (
          <Link key={href + String(label)} href={href as string}>
            <Card className="hover:bg-foreground/[0.02]">
              <CardContent className="pt-4">
                <p className="score-num text-3xl font-bold">{v}</p>
                <p className="text-xs text-muted">{label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
