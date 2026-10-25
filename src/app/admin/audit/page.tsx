import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { AuditTable, type AuditRow } from "./audit-table";

export default async function AdminAuditPage() {
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const admin = createAdminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_actor_profile_id_fkey(display_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.admin.auditLog}</h1>
      <AuditTable rows={(data as AuditRow[]) ?? []} dict={dict} />
    </div>
  );
}
