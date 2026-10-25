import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { RulesEditor } from "./rules-editor";
import type { AlertRule } from "@/lib/types";

export default async function AdminRulesPage() {
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const admin = createAdminClient();
  const { data: rules } = await admin.from("alert_rules").select("*").order("code");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.nav.rules}</h1>
      <RulesEditor dict={dict} rules={(rules as AlertRule[]) ?? []} />
    </div>
  );
}
