"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, getCurrentAthlete, getCurrentProfile } from "@/lib/auth";
import { addDays, todayInTz } from "@/lib/dates";
import {
  ACADEMY_LEVELS,
  deterministicShuffle,
  gradeAcademyAnswer,
  gradeTestAttempt,
  isAttemptExpired,
  parseAiAcademyPayload,
  redactAcademyItem,
  selectMonthlyReviewQuestionIds,
} from "@/lib/academy";
import type {
  AcademyItem,
  AcademyLevel,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
  PublicAcademyItem,
} from "@/lib/types";

/**
 * Athlete submits an answer to a daily or topic-practice item.
 * Idempotent: if a response already exists for (athlete_id, item_id), returns
 * the existing result without awarding duplicate points.
 */
export async function submitAcademyAnswer(input: {
  itemId: string;
  selectedOptionIds: string[];
  durationSec?: number;
}): Promise<{
  ok?: boolean;
  error?: string;
  isCorrect?: boolean;
  pointsAwarded?: number;
  revealedItem?: PublicAcademyItem;
}> {
  const profile = await getCurrentProfile();
  const athlete = await getCurrentAthlete();
  if (!profile || !athlete) return { error: "unauthenticated" };

  const admin = createAdminClient();
  const { data: rawItem } = await admin
    .from("academy_items")
    .select("*")
    .eq("id", input.itemId)
    .eq("published", true)
    .maybeSingle();
  const item = rawItem as AcademyItem | null;
  if (!item) return { error: "not_found" };

  // Check if already answered (idempotent guard against double-submit / point farming).
  const { data: existing } = await admin
    .from("academy_responses")
    .select("*")
    .eq("athlete_id", athlete.id)
    .eq("item_id", item.id)
    .maybeSingle();

  if (existing) {
    const prev = existing as AcademyResponse;
    return {
      ok: true,
      isCorrect: prev.is_correct,
      pointsAwarded: prev.points_awarded,
      revealedItem: redactAcademyItem(item, true),
    };
  }

  const { isCorrect, points } = gradeAcademyAnswer(item, input.selectedOptionIds ?? []);
  const today = todayInTz(profile.timezone);
  const durationSec = Math.max(0, Math.min(3600, Math.round(input.durationSec ?? 0)));

  const { error } = await admin.from("academy_responses").insert({
    athlete_id: athlete.id,
    item_id: item.id,
    assigned_date: today,
    selected_option_ids: input.selectedOptionIds ?? [],
    is_correct: isCorrect,
    points_awarded: points,
    duration_sec: durationSec,
  });

  if (error && error.code !== "23505") {
    return { error: error.message };
  }

  await audit("academy.item.submit", "academy_items", item.id, {
    isCorrect,
    points,
  });
  revalidatePath("/athlete/academy");
  revalidatePath("/athlete");

  return {
    ok: true,
    isCorrect,
    pointsAwarded: points,
    revealedItem: redactAcademyItem(item, true),
  };
}

/**
 * Starts a new monthly test attempt or resumes an in-progress one.
 * Returns redacted questions (no correct_option_ids or explanations).
 */
export async function startOrResumeAcademyTest(testId: string): Promise<{
  ok?: boolean;
  error?: string;
  attempt?: AcademyTestAttempt;
  questions?: PublicAcademyItem[];
}> {
  const profile = await getCurrentProfile();
  const athlete = await getCurrentAthlete();
  if (!profile || !athlete) return { error: "unauthenticated" };

  const admin = createAdminClient();
  const { data: rawTest } = await admin
    .from("academy_tests")
    .select("*")
    .eq("id", testId)
    .eq("published", true)
    .maybeSingle();
  const test = rawTest as AcademyTest | null;
  if (!test) return { error: "not_found" };

  const today = todayInTz(profile.timezone);
  if (today < test.available_from || today > test.available_until) {
    return { error: "test_window_closed" };
  }

  const { data: existingRows } = await admin
    .from("academy_test_attempts")
    .select("*")
    .eq("test_id", test.id)
    .eq("athlete_id", athlete.id)
    .order("attempt_number", { ascending: true });

  const attempts = (existingRows as AcademyTestAttempt[] | null) ?? [];

  // Check if there is an active in_progress attempt; expire it if timed out.
  let active = attempts.find((a) => a.status === "in_progress") ?? null;
  if (active && isAttemptExpired(active, test, new Date(), today)) {
    await admin
      .from("academy_test_attempts")
      .update({ status: "expired", submitted_at: new Date().toISOString() })
      .eq("id", active.id);
    active.status = "expired";
    active = null;
  }

  if (!active) {
    if (attempts.length >= test.max_attempts) {
      return { error: "max_attempts_reached" };
    }
    const nextNum = attempts.length + 1;
    const shuffledIds = deterministicShuffle(
      test.question_ids,
      `${athlete.id}:${test.id}:${nextNum}`,
    ).slice(0, test.question_count);

    const { data: created, error } = await admin
      .from("academy_test_attempts")
      .insert({
        test_id: test.id,
        athlete_id: athlete.id,
        attempt_number: nextNum,
        question_order: shuffledIds,
        draft_answers: {},
        final_answers: {},
        total_count: shuffledIds.length,
        status: "in_progress",
      })
      .select("*")
      .single();

    if (error || !created) return { error: error?.message ?? "create_failed" };
    active = created as AcademyTestAttempt;
  }

  const { data: qRows } = await admin
    .from("academy_items")
    .select("*")
    .in("id", active.question_order);

  const byId = new Map(((qRows as AcademyItem[] | null) ?? []).map((q) => [q.id, q]));
  const orderedQuestions = active.question_order
    .map((id) => byId.get(id))
    .filter((q): q is AcademyItem => Boolean(q))
    .map((q) => redactAcademyItem(q, false, `${active!.id}`));

  return { ok: true, attempt: active, questions: orderedQuestions };
}

/** Saves draft answers during an in-progress test so closing the PWA never loses progress. */
export async function saveAcademyTestDraft(input: {
  attemptId: string;
  draftAnswers: Record<string, string[]>;
}): Promise<{ ok?: boolean; error?: string }> {
  const athlete = await getCurrentAthlete();
  if (!athlete) return { error: "unauthenticated" };

  const admin = createAdminClient();
  const { data: raw } = await admin
    .from("academy_test_attempts")
    .select("*")
    .eq("id", input.attemptId)
    .eq("athlete_id", athlete.id)
    .maybeSingle();
  const attempt = raw as AcademyTestAttempt | null;
  if (!attempt || attempt.status !== "in_progress") return { error: "not_in_progress" };

  await admin
    .from("academy_test_attempts")
    .update({ draft_answers: input.draftAnswers })
    .eq("id", attempt.id);
  return { ok: true };
}

/** Submits and grades a monthly test attempt, then reveals full explanations for all questions. */
export async function submitAcademyTest(input: {
  attemptId: string;
  answers: Record<string, string[]>;
}): Promise<{
  ok?: boolean;
  error?: string;
  attempt?: AcademyTestAttempt;
  revealedQuestions?: PublicAcademyItem[];
}> {
  const profile = await getCurrentProfile();
  const athlete = await getCurrentAthlete();
  if (!profile || !athlete) return { error: "unauthenticated" };

  const admin = createAdminClient();
  const { data: rawAttempt } = await admin
    .from("academy_test_attempts")
    .select("*")
    .eq("id", input.attemptId)
    .eq("athlete_id", athlete.id)
    .maybeSingle();
  const attempt = rawAttempt as AcademyTestAttempt | null;
  if (!attempt) return { error: "not_found" };

  const { data: rawTest } = await admin
    .from("academy_tests")
    .select("*")
    .eq("id", attempt.test_id)
    .maybeSingle();
  const test = rawTest as AcademyTest | null;
  if (!test) return { error: "not_found" };

  const { data: qRows } = await admin
    .from("academy_items")
    .select("*")
    .in("id", attempt.question_order);
  const byId = new Map(((qRows as AcademyItem[] | null) ?? []).map((q) => [q.id, q]));
  const ordered = attempt.question_order
    .map((id) => byId.get(id))
    .filter((q): q is AcademyItem => Boolean(q));

  // If already submitted, return existing result idempotently.
  if (attempt.status === "submitted") {
    return {
      ok: true,
      attempt,
      revealedQuestions: ordered.map((q) => redactAcademyItem(q, true)),
    };
  }

  const today = todayInTz(profile.timezone);
  const expired = isAttemptExpired(attempt, test, new Date(), today);
  const finalAnswers = expired
    ? { ...attempt.draft_answers, ...input.answers }
    : input.answers;

  const graded = gradeTestAttempt(ordered, finalAnswers);
  const nextStatus = expired ? "expired" : "submitted";

  const { data: updated, error } = await admin
    .from("academy_test_attempts")
    .update({
      final_answers: finalAnswers,
      score_pct: graded.scorePct,
      correct_count: graded.correctCount,
      total_count: graded.totalCount,
      topic_breakdown: graded.topicBreakdown,
      status: nextStatus,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .select("*")
    .single();

  if (error || !updated) return { error: error?.message ?? "submit_failed" };

  await audit("academy.test.submit", "academy_test_attempts", attempt.id, {
    scorePct: graded.scorePct,
    status: nextStatus,
  });
  revalidatePath("/athlete/academy");
  revalidatePath("/coach/academy");

  return {
    ok: true,
    attempt: updated as AcademyTestAttempt,
    revealedQuestions: ordered.map((q) => redactAcademyItem(q, true)),
  };
}

// ============================================================================
// Coach / Admin Management Actions (including 1-click AI Batch Import)
// ============================================================================

export async function importAiAcademyBatch(input: {
  rawJson: string;
  scheduleStartDate?: string | null;
  targetGroupId?: string | null;
}): Promise<{ ok?: boolean; error?: string; importedCount?: number; testCreated?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }

  const parsed = parseAiAcademyPayload(input.rawJson);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  const startDate =
    input.scheduleStartDate && /^\d{4}-\d{2}-\d{2}$/.test(input.scheduleStartDate)
      ? input.scheduleStartDate
      : null;
  const groupId = input.targetGroupId || null;

  const rows = parsed.data.items.map((it, idx) => ({
    code: it.code,
    item_type: it.item_type,
    topic: it.topic,
    difficulty: it.difficulty,
    min_age: it.min_age,
    max_age: it.max_age,
    title: it.title,
    body: it.body,
    options: it.options,
    correct_option_ids: it.correct_option_ids,
    explanation: it.explanation,
    source_ref: it.source_ref ?? null,
    court_diagram: it.court_diagram ?? null,
    scheduled_date: it.scheduled_date ?? (startDate ? addDays(startDate, idx) : null),
    target_group_id: groupId,
    published: true,
    created_by: profile.id,
  }));

  const { data: insertedItems, error } = await admin
    .from("academy_items")
    .upsert(rows, { onConflict: "code" })
    .select("id, item_type, topic");

  if (error) return { error: error.message };
  const createdList = (insertedItems as { id: string; item_type: string; topic: string }[] | null) ?? [];

  let testCreated = false;
  if (parsed.data.test && createdList.length > 0) {
    const t = parsed.data.test;
    const today = todayInTz(profile.timezone);
    const quizIds = createdList.filter((i) => i.item_type !== "fact").map((i) => i.id);
    const topics = [...new Set(createdList.map((i) => i.topic))];
    if (quizIds.length > 0) {
      const { error: tErr } = await admin.from("academy_tests").upsert(
        {
          code: t.code,
          title: t.title,
          description: t.description,
          topics,
          difficulty: t.difficulty,
          question_ids: quizIds,
          question_count: quizIds.length,
          time_limit_minutes: t.time_limit_minutes ?? 12,
          target_group_id: groupId,
          available_from: today,
          available_until: addDays(today, t.available_days),
          max_attempts: t.max_attempts,
          published: true,
          created_by: profile.id,
        },
        { onConflict: "code" },
      );
      if (!tErr) testCreated = true;
    }
  }

  await audit("academy.ai_import", "academy_items", profile.id, {
    count: createdList.length,
    testCreated,
  });
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return { ok: true, importedCount: createdList.length, testCreated };
}

export async function toggleAcademyItemPublished(input: {
  id: string;
  published: boolean;
}): Promise<{ ok?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("academy_items")
    .update({ published: input.published })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return { ok: true };
}

export async function deleteAcademyItem(id: string): Promise<{ ok?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("academy_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return { ok: true };
}

export async function setAthleteAcademyLevel(input: {
  athleteId: string;
  level: AcademyLevel;
}): Promise<{ ok?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }
  if (!ACADEMY_LEVELS.includes(input.level)) return { error: "validation" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("athletes")
    .update({ academy_level: input.level })
    .eq("id", input.athleteId);
  if (error) return { error: error.message };
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return { ok: true };
}

/**
 * 1-click builder for the end-of-month review test: collects all quiz questions
 * that athletes encountered in the current month (plus fallback from the library
 * if fewer than `questionCount`) and publishes/updates the monthly test.
 */
export async function createMonthlyReviewTest(input?: {
  questionCount?: number;
  openImmediately?: boolean;
}): Promise<{
  ok?: boolean;
  error?: string;
  questionCount?: number;
  fromThisMonthCount?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }

  const today = todayInTz(profile.timezone);
  const [y, m] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthPrefix = today.slice(0, 7);
  const lastDay = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;

  const admin = createAdminClient();
  const [{ data: rawItems }, { data: rawResps }] = await Promise.all([
    admin.from("academy_items").select("*").eq("published", true).order("created_at", { ascending: true }),
    admin.from("academy_responses").select("item_id, assigned_date"),
  ]);

  const items = (rawItems as AcademyItem[] | null) ?? [];
  const resps =
    (rawResps as Pick<AcademyResponse, "item_id" | "assigned_date">[] | null) ?? [];

  const maxQ = Math.min(20, Math.max(3, input?.questionCount ?? 10));
  const { questionIds, fromThisMonthCount } = selectMonthlyReviewQuestionIds(
    items,
    resps,
    today,
    maxQ,
  );
  if (questionIds.length === 0) return { error: "no_questions" };

  const selectedSet = new Set(questionIds);
  const topics = [
    ...new Set(items.filter((i) => selectedSet.has(i.id)).map((i) => i.topic)),
  ];
  const openNow = input?.openImmediately ?? true;
  const availableFrom = openNow ? today : addDays(lastDay, -2);
  const availableUntil = addDays(lastDay, 5);
  const code = `monthly_review_${monthPrefix.replace("-", "_")}`;

  const { error } = await admin.from("academy_tests").upsert(
    {
      code,
      title: {
        ru: `Итоговый зачёт месяца (${monthPrefix}) — по пройденным вопросам`,
        en: `Monthly Review (${monthPrefix}) — from this month's lessons`,
        ro: `Testul lunii (${monthPrefix}) — din lecțiile parcurse`,
      },
      description: {
        ru: `Проверочный зачёт составлен из вопросов, которые вы проходили в ежедневных уроках за ${monthPrefix}. После сдачи откроется полный разбор каждого ответа!`,
        en: `Review test built from the questions covered in daily lessons during ${monthPrefix}. Full explanations appear after submission!`,
        ro: `Test construit din întrebările parcurse în lecțiile zilnice din ${monthPrefix}. Explicațiile apar după trimitere!`,
      },
      topics,
      difficulty: "beginner",
      question_ids: questionIds,
      question_count: questionIds.length,
      time_limit_minutes: 12,
      target_group_id: null,
      target_athlete_ids: [],
      available_from: availableFrom,
      available_until: availableUntil,
      max_attempts: 2,
      published: true,
      created_by: profile.id,
    },
    { onConflict: "code" },
  );

  if (error) return { error: error.message };

  await audit("academy.monthly_review.create", "academy_tests", profile.id, {
    code,
    questionCount: questionIds.length,
    fromThisMonthCount,
  });
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return {
    ok: true,
    questionCount: questionIds.length,
    fromThisMonthCount,
  };
}
