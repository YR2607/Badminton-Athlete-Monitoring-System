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
  uniqueItemCodes,
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
}): Promise<{
  ok?: boolean;
  error?: string;
  importedCount?: number;
  testCreated?: boolean;
  renamedCount?: number;
  renamedCodes?: string[];
}> {
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

  // Safety net: an AI pack reusing an existing "code" must not silently
  // overwrite the old card (its stats/schedule stay attached). Colliding
  // codes are remapped to `code_r`, `code_r2`, … and inserted as NEW items.
  const incomingCodes = parsed.data.items.map((it) => it.code);
  const { data: existingRows } = await admin
    .from("academy_items")
    .select("code")
    .in("code", incomingCodes);
  const existingCodes = new Set(
    ((existingRows as { code: string }[] | null) ?? []).map((r) => r.code),
  );
  const remappedCodes = uniqueItemCodes(incomingCodes, existingCodes);
  const renamedCodes = remappedCodes.filter((c, i) => c !== incomingCodes[i]);

  const rows = parsed.data.items.map((it, idx) => ({
    code: remappedCodes[idx],
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
    .insert(rows)
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
    renamedCount: renamedCodes.length,
  });
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return {
    ok: true,
    importedCount: createdList.length,
    testCreated,
    renamedCount: renamedCodes.length,
    renamedCodes: renamedCodes.slice(0, 5),
  };
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

/** Publishes every draft item in one click — the pool model: you add cards,
 *  the system serves them automatically; no per-card publishing needed. */
export async function publishAllDraftItems(): Promise<{
  ok?: boolean;
  error?: string;
  count?: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("academy_items")
    .update({ published: true })
    .eq("published", false)
    .select("id");
  if (error) return { error: error.message };
  await audit("academy.publish_all_drafts", "academy_items", profile.id, {
    count: data?.length ?? 0,
  });
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return { ok: true, count: data?.length ?? 0 };
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

/**
 * Month planner: distributes unscheduled (reserve) published cards across the
 * days of a given month ("YYYY-MM"). Each day may hold up to `perDay` cards in
 * TOTAL, counting cards already pinned to that date; days before today are
 * skipped and the earliest non-full day is filled first. Reserve cards are
 * consumed in `created_at` order.
 */
export async function autoScheduleMonth(input: {
  month: string;
  perDay: number;
}): Promise<{
  ok?: boolean;
  error?: string;
  scheduledCount?: number;
  daysUsed?: number;
  month?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { error: "forbidden" };
  }
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { error: "validation" };
  const perDay = Math.min(6, Math.max(1, Math.round(input.perDay || 2)));

  const today = todayInTz(profile.timezone);
  const [y, m] = input.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDay = `${input.month}-01`;
  const lastDay = `${input.month}-${String(daysInMonth).padStart(2, "0")}`;

  const admin = createAdminClient();
  const [{ data: scheduledRows }, { data: reserveRows }] = await Promise.all([
    admin
      .from("academy_items")
      .select("id, scheduled_date")
      .gte("scheduled_date", firstDay)
      .lte("scheduled_date", lastDay),
    admin
      .from("academy_items")
      .select("id")
      .eq("published", true)
      .is("scheduled_date", null)
      .order("created_at", { ascending: true }),
  ]);

  // Cards already pinned inside this month occupy part of each day's quota.
  const perDayCount = new Map<string, number>();
  for (const row of (scheduledRows as { id: string; scheduled_date: string }[] | null) ?? []) {
    perDayCount.set(
      row.scheduled_date,
      (perDayCount.get(row.scheduled_date) ?? 0) + 1,
    );
  }

  const reserveIds = ((reserveRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (reserveIds.length === 0) {
    return { ok: true, scheduledCount: 0, daysUsed: 0, month: input.month };
  }

  const assignments = new Map<string, string[]>();
  let idx = 0;
  for (let d = 1; d <= daysInMonth && idx < reserveIds.length; d++) {
    const date = `${input.month}-${String(d).padStart(2, "0")}`;
    if (date < today) continue; // never schedule into the past
    const already = perDayCount.get(date) ?? 0;
    const free = perDay - already;
    if (free <= 0) continue;
    const ids = reserveIds.slice(idx, idx + free);
    idx += ids.length;
    if (ids.length > 0) assignments.set(date, ids);
  }

  const updates = [...assignments.entries()].map(([date, ids]) =>
    admin.from("academy_items").update({ scheduled_date: date }).in("id", ids),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  await audit("academy.auto_schedule_month", "academy_items", profile.id, {
    month: input.month,
    perDay,
    scheduledCount: idx,
    daysUsed: assignments.size,
  });
  revalidatePath("/coach/academy");
  revalidatePath("/athlete/academy");
  return {
    ok: true,
    scheduledCount: idx,
    daysUsed: assignments.size,
    month: input.month,
  };
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
  // The monthly test appears on the last day of the month by default.
  const openNow = input?.openImmediately ?? false;
  const availableFrom = openNow ? today : lastDay;
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
