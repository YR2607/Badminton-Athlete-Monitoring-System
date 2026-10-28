import { redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDictionary } from "@/i18n";
import { todayInTz } from "@/lib/dates";
import { isFlagEnabled } from "@/lib/flags";
import {
  computeAthleteAcademyProgress,
  redactAcademyItem,
  selectDailyLesson,
} from "@/lib/academy";
import { AcademyClient } from "./academy-client";
import type {
  AcademyItem,
  AcademyLevel,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
} from "@/lib/types";

export default async function AthleteAcademyPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("athlete_id", athlete.id)
    .is("left_at", null);
  const groupIds = (memberships ?? []).map((m: { group_id: string }) => m.group_id);

  const academyOn = await isFlagEnabled("academy", groupIds);
  if (!academyOn) redirect("/athlete");

  const dict = getDictionary(profile.preferred_language);
  const today = todayInTz(profile.timezone);
  const level: AcademyLevel = athlete.academy_level ?? "beginner";

  const admin = createAdminClient();
  const [{ data: rawItems }, { data: rawResponses }, { data: rawTests }, { data: rawAttempts }] =
    await Promise.all([
      admin
        .from("academy_items")
        .select("*")
        .eq("published", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("academy_responses")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("completed_at", { ascending: false }),
      supabase
        .from("academy_tests")
        .select("*")
        .eq("published", true)
        .order("available_from", { ascending: false }),
      supabase
        .from("academy_test_attempts")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("started_at", { ascending: false }),
    ]);

  const items = (rawItems as AcademyItem[] | null) ?? [];
  const responses = (rawResponses as AcademyResponse[] | null) ?? [];
  const allTests = ((rawTests as AcademyTest[] | null) ?? []).filter(
    (t) =>
      (t.target_group_id === null || groupIds.includes(t.target_group_id)) &&
      (t.target_athlete_ids.length === 0 || t.target_athlete_ids.includes(athlete.id)),
  );
  const attempts = (rawAttempts as AcademyTestAttempt[] | null) ?? [];

  const answeredSet = new Set(responses.map((r) => r.item_id));
  const dailyItems = selectDailyLesson(items, responses, {
    athleteId: athlete.id,
    today,
    level,
    groupIds,
  });

  // SECURITY: Redact correct_option_ids & explanation for any unanswered item!
  const publicDaily = dailyItems.map((it) =>
    redactAcademyItem(it, answeredSet.has(it.id), `${athlete.id}:${today}`),
  );
  const publicCatalog = items
    .filter((it) => it.target_group_id === null || groupIds.includes(it.target_group_id))
    .map((it) => redactAcademyItem(it, answeredSet.has(it.id), `${athlete.id}`));

  const progress = computeAthleteAcademyProgress(items, responses, attempts);

  return (
    <AcademyClient
      dict={dict}
      locale={profile.preferred_language}
      today={today}
      level={level}
      dailyItems={publicDaily}
      catalog={publicCatalog}
      responses={responses}
      tests={allTests}
      attempts={attempts}
      progress={progress}
    />
  );
}
