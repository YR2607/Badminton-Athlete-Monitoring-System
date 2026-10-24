import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { isFlagEnabled } from "@/lib/flags";
import { redirect } from "next/navigation";
import { TestsBatchEntry } from "./batch-entry";
import type { Athlete, FieldTest, Group, Profile } from "@/lib/types";

export default async function CoachTestsPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("athlete_id, group_id, group:groups(name)")
    .is("left_at", null);
  const groupIds = [...new Set((memberships ?? []).map((m) => m.group_id))];
  if (!(await isFlagEnabled("field_tests", groupIds))) redirect("/coach");

  const [{ data: athletes }, { data: groups }, { data: tests }, { data: profs }] =
    await Promise.all([
      supabase.from("athletes").select("id, athlete_code, profile_id, status").neq("status", "archived"),
      supabase.from("groups").select("*"),
      supabase.from("field_tests").select("*").eq("active", true).order("sort_order"),
      supabase.from("profiles").select("id, display_name"),
    ]);

  const nameById = new Map(((profs as Profile[] | null) ?? []).map((p) => [p.id, p.display_name]));
  const groupById = new Map(((groups as Group[] | null) ?? []).map((g) => [g.id, g.name]));
  const groupOf = new Map<string, string>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    if (!groupOf.has(m.athlete_id)) groupOf.set(m.athlete_id, m.group_id);
  }
  const roster = ((athletes as Pick<Athlete, "id" | "athlete_code" | "profile_id">[] | null) ?? [])
    .map((a) => ({
      id: a.id,
      name: nameById.get(a.profile_id) ?? a.athlete_code,
      groupId: groupOf.get(a.id) ?? null,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{dict.tests.batchTitle}</h1>
        <p className="text-sm text-muted">{dict.tests.batchHint}</p>
      </div>
      <TestsBatchEntry
        dict={dict}
        lang={profile.preferred_language}
        tests={(tests as FieldTest[] | null) ?? []}
        athletes={roster}
        groups={[...groupById.entries()].map(([id, name]) => ({ id, name }))}
      />
    </div>
  );
}
