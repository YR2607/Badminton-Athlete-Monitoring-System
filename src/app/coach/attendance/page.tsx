import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { addDays, localDayUtcBounds, todayInTz } from "@/lib/dates";
import { plannedForDate, type PlanOverride, type ScheduleInput } from "@/lib/load";
import type { Athlete, Attendance, Group, Profile, TrainingSession } from "@/lib/types";
import { AttendanceClient, type AttendanceRow } from "./attendance-client";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; group?: string }>;
}) {
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const sp = await searchParams;
  const supabase = await createClient();
  const tz = me.timezone ?? "Europe/Chisinau";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayInTz(tz);

  const [{ data: groups }, { data: memberships }, { data: athletes }, { data: profs }] =
    await Promise.all([
      supabase.from("groups").select("id, name").order("name"),
      supabase.from("group_memberships").select("athlete_id, group_id").is("left_at", null),
      supabase.from("athletes").select("*").eq("status", "active"),
      supabase.from("profiles").select("id, display_name, timezone"),
    ]);

  const groupList = (groups as Pick<Group, "id" | "name">[]) ?? [];
  const groupId =
    groupList.find((g) => g.id === sp.group)?.id ?? groupList[0]?.id ?? "";
  const profById = new Map(
    (((profs as Pick<Profile, "id" | "display_name" | "timezone">[]) ?? [])).map((p) => [p.id, p]),
  );
  const memberIds = new Set(
    ((memberships as { athlete_id: string; group_id: string }[] | null) ?? [])
      .filter((m) => m.group_id === groupId)
      .map((m) => m.athlete_id),
  );
  const roster = ((athletes as Athlete[]) ?? [])
    .filter((a) => memberIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: profById.get(a.profile_id)?.display_name ?? a.athlete_code,
      tz: profById.get(a.profile_id)?.timezone ?? tz,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const ids = roster.map((r) => r.id);
  const { start, end } = localDayUtcBounds(date, tz);

  const [
    { data: schedules },
    { data: overrides },
    { data: sessions },
    { data: marks },
  ] = await Promise.all([
    groupId
      ? supabase
          .from("training_schedules")
          .select("weekday, planned_minutes, planned_rpe")
          .eq("group_id", groupId)
          .eq("active", true)
      : Promise.resolve({ data: [] }),
    groupId
      ? supabase
          .from("session_plan_overrides")
          .select("plan_date, cancelled, start_time, planned_minutes, planned_rpe")
          .eq("group_id", groupId)
          .gte("plan_date", addDays(date, -1))
          .lte("plan_date", addDays(date, 1))
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("training_sessions")
          .select("athlete_id, started_at")
          .in("athlete_id", ids)
          .gte("started_at", start.toISOString())
          .lt("started_at", end.toISOString())
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("attendance")
          .select("*")
          .in("athlete_id", ids)
          .eq("att_date", date)
      : Promise.resolve({ data: [] }),
  ]);

  const scheduled = groupId
    ? plannedForDate(
        date,
        (schedules as ScheduleInput[]) ?? [],
        (overrides as PlanOverride[]) ?? [],
      ).scheduled
    : null;

  const markByAthlete = new Map(
    ((marks as Attendance[]) ?? []).map((m) => [m.athlete_id, m.status]),
  );
  const sessionAthletes = new Set(
    ((sessions as Pick<TrainingSession, "athlete_id" | "started_at">[]) ?? []).map(
      (s) => s.athlete_id,
    ),
  );

  const rows: AttendanceRow[] = roster.map((r) => ({
    id: r.id,
    name: r.name,
    hasSession: sessionAthletes.has(r.id),
    status: markByAthlete.get(r.id) ?? null,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{dict.attendance.title}</h1>
        <p className="text-sm text-muted">{dict.attendance.hint}</p>
      </div>
      <AttendanceClient
        dict={dict}
        groups={groupList}
        groupId={groupId}
        date={date}
        scheduled={scheduled}
        rows={rows}
      />
    </div>
  );
}
