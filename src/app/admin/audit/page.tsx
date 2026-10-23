import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";

interface AuditRow {
  id: string;
  actor_profile_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: { display_name?: string } | null;
}

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
      <h1 className="text-xl font-bold">{dict.admin.auditLog}</h1>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">{dict.common.date}</th>
              <th className="px-3 py-2 font-medium">{dict.admin.actor}</th>
              <th className="px-3 py-2 font-medium">{dict.admin.action}</th>
              <th className="px-3 py-2 font-medium">{dict.admin.target}</th>
              <th className="px-3 py-2 font-medium">metadata</th>
            </tr>
          </thead>
          <tbody>
            {((data as AuditRow[]) ?? []).map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                <td className="px-3 py-2">{r.actor?.display_name ?? "system"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 text-muted">{r.target_type}</td>
                <td className="max-w-64 truncate px-3 py-2 text-xs text-muted">
                  {JSON.stringify(r.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
