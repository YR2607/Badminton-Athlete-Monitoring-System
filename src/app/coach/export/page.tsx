import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { scopedAthleteIds } from "@/lib/coach-data";
import { ExportForm } from "./export-form";
import type { Athlete, Group, Profile } from "@/lib/types";

export default async function ExportPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const ids = await scopedAthleteIds(supabase);

  const [{ data: athletes }, { data: memberships }, { data: groups }] = ids.length
    ? await Promise.all([
        supabase.from("athletes").select("*").in("id", ids),
        supabase.from("group_memberships").select("athlete_id, group:groups(name)").in("athlete_id", ids).is("left_at", null),
        supabase.from("groups").select("*"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const { data: profs } = ids.length
    ? await supabase.from("profiles").select("*").in("id", ((athletes as Athlete[] | null) ?? []).map((a) => a.profile_id))
    : { data: [] };

  const profById = new Map(((profs as Profile[] | null) ?? []).map((p) => [p.id, p]));
  const groupOf = new Map(
    ((memberships as { athlete_id: string; group?: { name: string } }[] | null) ?? []).map((m) => [
      m.athlete_id,
      m.group?.name ?? "",
    ]),
  );

  const options = ((athletes as Athlete[] | null) ?? []).map((a) => ({
    id: a.id,
    label: `${profById.get(a.profile_id)?.display_name ?? a.athlete_code} (${groupOf.get(a.id) || "—"})`,
  }));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="font-display text-xl font-bold tracking-tight">{dict.export.title}</h1>
      <ExportForm dict={dict} athletes={options} groups={(groups as Group[]) ?? []} />
    </div>
  );
}
