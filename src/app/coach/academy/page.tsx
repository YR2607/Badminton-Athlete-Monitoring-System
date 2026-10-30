import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDictionary } from "@/i18n";
import { todayInTz } from "@/lib/dates";
import { scopedAthleteIds } from "@/lib/coach-data";
import { computeGroupErrorAnalytics } from "@/lib/academy";
import { CoachAcademyClient, type CoachAthleteAcademyRow } from "./coach-academy-client";
import type {
  AcademyItem,
  AcademyLevel,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
  Athlete,
  Group,
  Profile,
} from "@/lib/types";

export default async function CoachAcademyPage() {
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const supabase = await createClient();
  const admin = createAdminClient();

  const athleteIds = await scopedAthleteIds(supabase);

  const [
    { data: rawItems },
    { data: rawTests },
    { data: rawGroups },
    { data: rawAthletes },
    { data: rawProfiles },
    { data: rawResponses },
    { data: rawAttempts },
  ] = await Promise.all([
    admin.from("academy_items").select("*").order("created_at", { ascending: false }),
    admin.from("academy_tests").select("*").order("created_at", { ascending: false }),
    supabase.from("groups").select("*").order("name"),
    athleteIds.length
      ? admin.from("athletes").select("*").in("id", athleteIds)
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, display_name"),
    athleteIds.length
      ? admin
          .from("academy_responses")
          .select("*")
          .in("athlete_id", athleteIds)
          .order("completed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    athleteIds.length
      ? admin
          .from("academy_test_attempts")
          .select("*")
          .in("athlete_id", athleteIds)
          .order("started_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const items = (rawItems as AcademyItem[] | null) ?? [];
  const tests = (rawTests as AcademyTest[] | null) ?? [];
  const groups = (rawGroups as Group[] | null) ?? [];
  const athletes = (rawAthletes as Athlete[] | null) ?? [];
  const nameByProfile = new Map(
    ((rawProfiles as Pick<Profile, "id" | "display_name">[] | null) ?? []).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  const responses = (rawResponses as AcademyResponse[] | null) ?? [];
  const attempts = (rawAttempts as AcademyTestAttempt[] | null) ?? [];

  const errorStats = computeGroupErrorAnalytics(items, responses, attempts);

  const athleteRows: CoachAthleteAcademyRow[] = athletes
    .map((a) => {
      const name = nameByProfile.get(a.profile_id) ?? a.athlete_code;
      const myResps = responses.filter((r) => r.athlete_id === a.id);
      const mySubAttempts = attempts.filter(
        (at) => at.athlete_id === a.id && at.status === "submitted",
      );
      const xp =
        myResps.reduce((s, r) => s + r.points_awarded, 0) +
        new Set(mySubAttempts.filter((at) => (at.score_pct ?? 0) >= 70).map((at) => at.test_id))
          .size *
          25;
      const correct = myResps.filter((r) => r.is_correct).length;
      const accuracyPct = myResps.length > 0 ? Math.round((correct / myResps.length) * 100) : null;
      const bestTestPct =
        mySubAttempts.length > 0
          ? Math.max(...mySubAttempts.map((at) => at.score_pct ?? 0))
          : null;

      return {
        id: a.id,
        name,
        code: a.athlete_code,
        level: (a.academy_level ?? "beginner") as AcademyLevel,
        xp,
        completedCount: myResps.length,
        accuracyPct,
        bestTestPct,
      };
    })
    .sort((x, y) => y.xp - x.xp || x.name.localeCompare(y.name));

  return (
    <CoachAcademyClient
      dict={dict}
      locale={me.preferred_language}
      today={todayInTz(me.timezone)}
      items={items}
      tests={tests}
      groups={groups}
      errorStats={errorStats}
      athleteRows={athleteRows}
      responses={responses}
      attempts={attempts}
    />
  );
}
