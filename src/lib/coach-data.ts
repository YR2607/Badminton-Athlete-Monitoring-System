import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz, addDays } from "@/lib/dates";
import { dailyReadiness, normalizeCheckin, readinessScore } from "@/lib/readiness";
import type {
  Alert,
  Athlete,
  Group,
  MorningCheckin,
  Profile,
  TrainingSession,
} from "@/lib/types";

export interface CoachAthleteRow {
  athlete: Athlete;
  profile: Profile | null;
  group: Group | null;
  age: number | null;
  todayCheckin: MorningCheckin | null;
  lastCheckinDate: string | null;
  readiness: number | null;
  readinessDelta: number | null;
  lastLoad: number | null;
  openAlerts: Alert[];
  hasPain: boolean;
  missedYesterday: boolean;
}

/** All athletes the coach can see: via group assignments + direct assignments. */
export async function coachAthleteIds(
  supabase: SupabaseClient,
  coachProfileId: string,
): Promise<string[]> {
  const { data: assignments } = await supabase
    .from("coach_assignments")
    .select("group_id, athlete_id")
    .eq("coach_profile_id", coachProfileId);
  const ids = new Set<string>();
  const groupIds: string[] = [];
  for (const a of assignments ?? []) {
    if (a.athlete_id) ids.add(a.athlete_id);
    if (a.group_id) groupIds.push(a.group_id);
  }
  if (groupIds.length > 0) {
    const { data: members } = await supabase
      .from("group_memberships")
      .select("athlete_id")
      .in("group_id", groupIds)
      .is("left_at", null);
    for (const m of members ?? []) ids.add(m.athlete_id);
  }
  return [...ids];
}

export async function coachDashboard(
  supabase: SupabaseClient,
  coachProfileId: string,
  tz: string,
): Promise<{ rows: CoachAthleteRow[]; groups: Group[] }> {
  const ids = await coachAthleteIds(supabase, coachProfileId);
  if (ids.length === 0) return { rows: [], groups: [] };
  const today = todayInTz(tz);
  const yesterday = addDays(today, -1);
  const since14 = addDays(today, -13);

  const [
    { data: athletes },
    { data: memberships },
    { data: groups },
    { data: checkins },
    { data: sessions },
    { data: alerts },
  ] = await Promise.all([
    supabase.from("athletes").select("*").in("id", ids),
    supabase.from("group_memberships").select("*, group:groups(*)").in("athlete_id", ids).is("left_at", null),
    supabase.from("groups").select("*"),
    supabase.from("morning_checkins").select("*").in("athlete_id", ids).gte("checkin_date", since14),
    supabase.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", `${since14}T00:00:00Z`),
    supabase.from("alerts").select("*").in("athlete_id", ids).eq("status", "open"),
  ]);

  const profileIds = (athletes as Athlete[] | null)?.map((a) => a.profile_id) ?? [];
  const { data: profs } = profileIds.length
    ? await supabase.from("profiles").select("*").in("id", profileIds)
    : { data: [] as Profile[] };

  const groupById = new Map(((groups as Group[]) ?? []).map((g) => [g.id, g]));
  const profById = new Map((profs as Profile[] ?? []).map((p) => [p.id, p]));
  const groupOfAthlete = new Map<string, Group>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    const g = groupById.get(m.group_id);
    if (g && !groupOfAthlete.has(m.athlete_id)) groupOfAthlete.set(m.athlete_id, g);
  }

  const checkinsByAthlete = new Map<string, MorningCheckin[]>();
  for (const c of (checkins as MorningCheckin[] | null) ?? []) {
    const list = checkinsByAthlete.get(c.athlete_id) ?? [];
    list.push(c);
    checkinsByAthlete.set(c.athlete_id, list);
  }
  const lastSession = new Map<string, TrainingSession>();
  for (const s of (sessions as TrainingSession[] | null) ?? []) {
    const cur = lastSession.get(s.athlete_id);
    if (!cur || s.started_at > cur.started_at) lastSession.set(s.athlete_id, s);
  }
  const alertsByAthlete = new Map<string, Alert[]>();
  for (const a of (alerts as Alert[] | null) ?? []) {
    const list = alertsByAthlete.get(a.athlete_id) ?? [];
    list.push(a);
    alertsByAthlete.set(a.athlete_id, list);
  }

  const year = new Date().getUTCFullYear();
  const rows: CoachAthleteRow[] = ((athletes as Athlete[]) ?? []).map((a) => {
    const list = (checkinsByAthlete.get(a.id) ?? []).sort((x, y) =>
      x.checkin_date.localeCompare(y.checkin_date),
    );
    const todayC = list.find((c) => c.checkin_date === today) ?? null;
    const lastC = list[list.length - 1] ?? null;
    const series = dailyReadiness(list);
    const todayScore = series.find((s) => s.date === today)?.score ?? null;
    const prevScores = series.filter((s) => s.date < today).map((s) => s.score);
    const baselineAvg =
      prevScores.length > 0 ? prevScores.reduce((x, y) => x + y, 0) / prevScores.length : null;
    const last = lastSession.get(a.id) ?? null;
    const openAlerts = alertsByAthlete.get(a.id) ?? [];
    const recentPain = list.some((c) => c.checkin_date >= yesterday && c.pain_status !== "none");

    return {
      athlete: a,
      profile: profById.get(a.profile_id) ?? null,
      group: groupOfAthlete.get(a.id) ?? null,
      age: a.birth_year ? year - a.birth_year : null,
      todayCheckin: todayC,
      lastCheckinDate: lastC?.checkin_date ?? null,
      readiness: todayScore ?? (lastC ? readinessScore(normalizeCheckin(lastC)) : null),
      readinessDelta:
        todayScore !== null && baselineAvg !== null
          ? Math.round((todayScore - baselineAvg) * 10) / 10
          : null,
      lastLoad: last?.session_load ?? null,
      openAlerts,
      hasPain: recentPain || openAlerts.some((al) => al.severity === "priority"),
      missedYesterday: !list.some((c) => c.checkin_date === yesterday),
    };
  });

  return { rows, groups: (groups as Group[]) ?? [] };
}
