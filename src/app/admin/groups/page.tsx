import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { GroupsManager } from "./groups-manager";
import { WeekPlan } from "./week-plan";
import { todayInTz, addDays } from "@/lib/dates";
import type { PlanOverride } from "@/lib/load";
import type { Athlete, Group, GroupMembership, Profile, TrainingSchedule } from "@/lib/types";

export default async function AdminGroupsPage() {
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const admin = createAdminClient();
  const today = todayInTz(me.timezone);

  const [{ data: groups }, { data: memberships }, { data: athletes }, { data: profiles }, { data: schedules }, { data: planOverrides }] =
    await Promise.all([
      admin.from("groups").select("*").order("name"),
      admin.from("group_memberships").select("*").is("left_at", null),
      admin.from("athletes").select("*"),
      admin.from("profiles").select("*"),
      admin.from("training_schedules").select("*").eq("active", true).order("weekday").order("start_time"),
      admin
        .from("session_plan_overrides")
        .select("*")
        .gte("plan_date", today)
        .lte("plan_date", addDays(today, 6)),
    ]);

  const profById = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
  const athleteOptions = ((athletes as Athlete[]) ?? [])
    .filter((a) => a.status !== "archived")
    .map((a) => ({
      id: a.id,
      label: `${profById.get(a.profile_id)?.display_name ?? a.athlete_code} (${a.athlete_code})`,
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.nav.groups}</h1>
      <GroupsManager
        dict={dict}
        groups={(groups as Group[]) ?? []}
        memberships={(memberships as GroupMembership[]) ?? []}
        athletes={athleteOptions}
        schedules={(schedules as TrainingSchedule[]) ?? []}
      />
      <WeekPlan
        dict={dict}
        groups={(groups as Group[]) ?? []}
        schedules={(schedules as TrainingSchedule[]) ?? []}
        overrides={(planOverrides as (PlanOverride & { group_id: string })[]) ?? []}
        today={today}
      />
    </div>
  );
}
