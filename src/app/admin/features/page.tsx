import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { FeaturesManager } from "./features-manager";
import type { FeatureFlag, Group } from "@/lib/types";

export default async function AdminFeaturesPage() {
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const admin = createAdminClient();

  const [{ data: flags }, { data: groups }] = await Promise.all([
    admin.from("feature_flags").select("*").order("key"),
    admin.from("groups").select("*").order("name"),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.admin.features.title}</h1>
      <FeaturesManager
        dict={dict}
        flags={(flags as FeatureFlag[]) ?? []}
        groups={(groups as Group[]) ?? []}
      />
    </div>
  );
}
