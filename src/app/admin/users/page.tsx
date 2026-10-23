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

  const [{ data: profiles }, { data: athletes }, { data: groups }, { data: memberships }, { data: authUsers }] = await Promise.all([
    admin.from("profiles").select("*").order("created_at", { ascending: false }),
    admin.from("athletes").select("*"),
    admin.from("groups").select("*").order("name"),
    admin.from("group_memberships").select("athlete_id, group_id").is("left_at", null),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const athleteByProfile = new Map(((athletes as Athlete[]) ?? []).map((a) => [a.profile_id, a]));
  const emailByUserId = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const groupOfAthlete = new Map<string, string>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    if (!groupOfAthlete.has(m.athlete_id)) groupOfAthlete.set(m.athlete_id, m.group_id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{dict.admin.users}</h1>
      <CreateUserForm dict={dict} groups={(groups as { id: string; name: string }[]) ?? []} />
      <UserTable
        dict={dict}
        selfId={me.id}
        groups={(groups as { id: string; name: string }[]) ?? []}
        profiles={((profiles as Profile[]) ?? []).map((p) => {
          const athlete = athleteByProfile.get(p.id) ?? null;
          return {
            ...p,
            athlete,
            email: emailByUserId.get(p.user_id) ?? null,
            groupId: athlete ? (groupOfAthlete.get(athlete.id) ?? null) : null,
          };
        })}
      />
    </div>
  );
}
