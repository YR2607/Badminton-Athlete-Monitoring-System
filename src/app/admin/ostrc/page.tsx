import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { OstrcZonesAdmin } from "./zones-admin";
import type { OstrcZone } from "@/lib/types";

export default async function AdminOstrcPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const { data: zones } = await supabase.from("ostrc_zones").select("*").order("sort_order");

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold tracking-tight">{dict.tests.adminTitle} — OSTRC</h1>
      <OstrcZonesAdmin dict={dict} zones={(zones as OstrcZone[] | null) ?? []} />
    </div>
  );
}
