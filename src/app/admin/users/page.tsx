import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { CreateUserForm } from "./create-user-form";
import { UserTable } from "./user-table";
import type { Athlete, Profile } from "@/lib/types";

export default async function AdminUsersPage() {
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const admin = createAdminClient();

  const [{ data: profiles }, { data: athletes }, { data: authUsers }] = await Promise.all([
    admin.from("profiles").select("*").order("created_at", { ascending: false }),
    admin.from("athletes").select("*"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const athleteByProfile = new Map(((athletes as Athlete[]) ?? []).map((a) => [a.profile_id, a]));
  const emailByUserId = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{dict.admin.users}</h1>
      <CreateUserForm dict={dict} />
      <UserTable
        dict={dict}
        profiles={((profiles as Profile[]) ?? []).map((p) => ({
          ...p,
          athlete: athleteByProfile.get(p.id) ?? null,
          email: emailByUserId.get(p.user_id) ?? null,
        }))}
      />
    </div>
  );
}
