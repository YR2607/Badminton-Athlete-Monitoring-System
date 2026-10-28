import { z } from "zod";
import type {
  AcademyItem,
  AcademyItemType,
  AcademyLevel,
  AcademyOption,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
  AcademyTopic,
  Locale,
  LocalizedText,
  PublicAcademyItem,
} from "@/lib/types";

export const ACADEMY_TOPICS: readonly AcademyTopic[] = [
  "rules",
  "technique",
  "singles_tactics",
  "doubles_tactics",
  "game_iq",
  "footwork",
  "conditioning",
  "recovery_prevention",
  "psychology",
  "history_facts",
] as const;

export const ACADEMY_ITEM_TYPES: readonly AcademyItemType[] = [
  "fact",
  "single_choice",
  "multi_choice",
  "tactical",
  "find_mistake",
  "rules",
  "technique",
  "physical_recovery",
  "psychology",
  "visual_tactical",
] as const;

export const ACADEMY_LEVELS: readonly AcademyLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

/** Safe localized string lookup with explicit language resolution. */
export function localizeText(
  text: Partial<LocalizedText> | null | undefined,
  locale: Locale,
): string {
  if (!text) return "";
  const primary = text[locale]?.trim();
  if (primary) return primary;
  const en = text.en?.trim();
  if (en) return `[EN] ${en}`;
  const ru = text.ru?.trim();
  if (ru) return `[RU] ${ru}`;
  const ro = text.ro?.trim();
  if (ro) return `[RO] ${ro}`;
  return "";
}

/** Deterministic 32-bit FNV-1a hash for seeded shuffling and daily selection. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic Fisher–Yates shuffle so question/option order is stable per attempt. */
export function deterministicShuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = [...arr];
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Strips `correct_option_ids` and `explanation` unless `revealSecrets` is true.
 * Options are optionally shuffled for questions (never for single-button `fact` items).
 */
export function redactAcademyItem(
  item: AcademyItem,
  revealSecrets: boolean,
  shuffleSeed?: string,
): PublicAcademyItem {
  const shouldShuffle =
    Boolean(shuffleSeed) && item.item_type !== "fact" && item.options.length > 1;
  const options: AcademyOption[] = shouldShuffle
    ? deterministicShuffle(item.options, `${shuffleSeed}:${item.id}`)
    : item.options;

  return {
    id: item.id,
    code: item.code,
    item_type: item.item_type,
    topic: item.topic,
    difficulty: item.difficulty,
    min_age: item.min_age,
    max_age: item.max_age,
    title: item.title,
    body: item.body,
    options,
    court_diagram: item.court_diagram,
    source_ref: revealSecrets ? item.source_ref : null,
    correct_option_ids: revealSecrets ? item.correct_option_ids : null,
    explanation: revealSecrets ? item.explanation : null,
  };
}

/** Base points by item type & difficulty. */
export function pointsForItem(item: Pick<AcademyItem, "item_type" | "difficulty">, isCorrect: boolean): number {
  if (item.item_type === "fact") return 5;
  if (!isCorrect) return 3; // small participation credit for reading explanation (once per item)
  switch (item.difficulty) {
    case "advanced":
      return 20;
    case "intermediate":
      return 15;
    default:
      return 10;
  }
}

/**
 * Exact set-match grading for single-choice, multi-choice, tactical, visual, and fact items.
 */
export function gradeAcademyAnswer(
  item: Pick<AcademyItem, "item_type" | "difficulty" | "correct_option_ids">,
  selectedOptionIds: readonly string[],
): { isCorrect: boolean; points: number } {
  const cleanSelected = [...new Set(selectedOptionIds.map((s) => s.trim()).filter(Boolean))].sort();
  const cleanExpected = [...new Set(item.correct_option_ids.map((s) => s.trim()).filter(Boolean))].sort();

  if (item.item_type === "fact") {
    return { isCorrect: true, points: pointsForItem(item, true) };
  }
  if (cleanSelected.length === 0 || cleanExpected.length === 0) {
    return { isCorrect: false, points: 0 };
  }
  const isCorrect =
    cleanSelected.length === cleanExpected.length &&
    cleanSelected.every((val, idx) => val === cleanExpected[idx]);

  return {
    isCorrect,
    points: pointsForItem(item, isCorrect),
  };
}

/**
 * Selects the daily 2–4 minute micro-lesson (up to 3 cards: 1 fact + 1 tactical/visual + 1 knowledge quiz)
 * without creating any backlog penalty if the athlete missed previous days.
 */
export function selectDailyLesson(
  items: readonly AcademyItem[],
  responses: readonly Pick<AcademyResponse, "item_id" | "assigned_date">[],
  opts: {
    athleteId: string;
    today: string;
    level: AcademyLevel;
    groupIds?: readonly string[];
  },
): AcademyItem[] {
  const groupSet = new Set(opts.groupIds ?? []);
  const eligible = items.filter(
    (it) =>
      it.published &&
      (it.target_group_id === null || groupSet.has(it.target_group_id)),
  );
  if (eligible.length === 0) return [];

  // 1. Items explicitly scheduled for today by coach/admin take priority.
  const scheduledToday = eligible.filter((it) => it.scheduled_date === opts.today);

  // 2. Any item the athlete already answered today stays in today's set so the
  //    completed state remains visible for the rest of the day.
  const answeredTodayIds = new Set(
    responses.filter((r) => r.assigned_date === opts.today).map((r) => r.item_id),
  );
  const answeredEverIds = new Set(responses.map((r) => r.item_id));

  const picked: AcademyItem[] = [];
  const pickedIds = new Set<string>();
  const add = (it: AcademyItem | undefined) => {
    if (it && !pickedIds.has(it.id) && picked.length < 3) {
      picked.push(it);
      pickedIds.add(it.id);
    }
  };

  for (const it of scheduledToday) add(it);
  for (const it of eligible) {
    if (answeredTodayIds.has(it.id)) add(it);
  }
  if (picked.length >= 3) return picked.slice(0, 3);

  // Prefer unanswered items matching athlete's level, then other levels, then recycle.
  const rankPool = (pool: AcademyItem[]) => {
    const unansweredSameLevel = pool.filter(
      (i) => !answeredEverIds.has(i.id) && i.difficulty === opts.level && !pickedIds.has(i.id),
    );
    const unansweredOther = pool.filter(
      (i) => !answeredEverIds.has(i.id) && i.difficulty !== opts.level && !pickedIds.has(i.id),
    );
    const fallbackAll = pool.filter((i) => !pickedIds.has(i.id));
    const chosen =
      unansweredSameLevel.length > 0
        ? unansweredSameLevel
        : unansweredOther.length > 0
          ? unansweredOther
          : fallbackAll;
    return deterministicShuffle(chosen, `${opts.athleteId}:${opts.today}`)[0];
  };

  // Slot 1: interesting fact
  if (!picked.some((p) => p.item_type === "fact")) {
    add(rankPool(eligible.filter((i) => i.item_type === "fact")));
  }
  // Slot 2: tactical / visual_tactical / find_mistake
  const tacticalTypes: AcademyItemType[] = ["visual_tactical", "tactical", "find_mistake"];
  if (!picked.some((p) => tacticalTypes.includes(p.item_type))) {
    add(rankPool(eligible.filter((i) => tacticalTypes.includes(i.item_type))));
  }
  // Slot 3: knowledge question (rules / technique / recovery / psychology / choice)
  while (picked.length < 3) {
    const next = rankPool(eligible.filter((i) => i.item_type !== "fact"));
    if (!next) break;
    add(next);
  }

  return picked;
}

/** Checks whether an in-progress test attempt has exceeded its time limit or window. */
export function isAttemptExpired(
  attempt: Pick<AcademyTestAttempt, "started_at" | "status">,
  test: Pick<AcademyTest, "time_limit_minutes" | "available_until">,
  now: Date = new Date(),
  todayIso?: string,
): boolean {
  if (attempt.status !== "in_progress") return false;
  if (todayIso && todayIso > test.available_until) return true;
  if (test.time_limit_minutes && test.time_limit_minutes > 0) {
    const startedMs = new Date(attempt.started_at).getTime();
    // Allow 30s grace period for network latency
    const limitMs = (test.time_limit_minutes * 60 + 30) * 1000;
    if (now.getTime() - startedMs > limitMs) return true;
  }
  return false;
}

/** Grades a monthly test attempt uniformly across all questions and computes per-topic accuracy. */
export function gradeTestAttempt(
  questions: readonly AcademyItem[],
  answers: Record<string, readonly string[]>,
): {
  scorePct: number;
  correctCount: number;
  totalCount: number;
  topicBreakdown: Record<string, { correct: number; total: number }>;
} {
  let correctCount = 0;
  const totalCount = questions.length;
  const topicBreakdown: Record<string, { correct: number; total: number }> = {};

  for (const q of questions) {
    const selected = answers[q.id] ?? [];
    const { isCorrect } = gradeAcademyAnswer(q, selected);
    if (isCorrect) correctCount++;
    const prev = topicBreakdown[q.topic] ?? { correct: 0, total: 0 };
    topicBreakdown[q.topic] = {
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    };
  }

  const scorePct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  return { scorePct, correctCount, totalCount, topicBreakdown };
}

export interface TopicProgressStat {
  topic: AcademyTopic;
  totalItems: number;
  completedItems: number;
  correctItems: number;
  accuracyPct: number | null;
  needsReview: boolean;
}

export interface AcademyBadgeProgress {
  code:
    | "first_step"
    | "curious_shuttle"
    | "tactician"
    | "rules_umpire"
    | "all_rounder"
    | "monthly_check";
  unlocked: boolean;
  progressText: string;
}

export interface AthleteAcademySummary {
  totalPoints: number;
  completedCount: number;
  correctCount: number;
  accuracyPct: number | null;
  topicStats: TopicProgressStat[];
  reviewTopics: AcademyTopic[];
  reviewItemIds: string[];
  badges: AcademyBadgeProgress[];
}

/** Computes personal progress, topics to review, and non-grind achievements. */
export function computeAthleteAcademyProgress(
  items: readonly AcademyItem[],
  responses: readonly AcademyResponse[],
  attempts: readonly AcademyTestAttempt[],
): AthleteAcademySummary {
  const published = items.filter((i) => i.published);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const respByItem = new Map(responses.map((r) => [r.item_id, r]));

  const dailyPoints = responses.reduce((acc, r) => acc + r.points_awarded, 0);
  // Bonus 25 XP once per passed test (score >= 70%), never stacked by spamming retries.
  const passedTestIds = new Set(
    attempts
      .filter((a) => a.status === "submitted" && (a.score_pct ?? 0) >= 70)
      .map((a) => a.test_id),
  );
  const totalPoints = dailyPoints + passedTestIds.size * 25;

  const quizResponses = responses.filter((r) => {
    const it = itemById.get(r.item_id);
    return it && it.item_type !== "fact";
  });
  const correctCount = quizResponses.filter((r) => r.is_correct).length;
  const accuracyPct =
    quizResponses.length > 0
      ? Math.round((correctCount / quizResponses.length) * 100)
      : null;

  const topicStats: TopicProgressStat[] = ACADEMY_TOPICS.map((topic) => {
    const topicItems = published.filter((i) => i.topic === topic);
    let completedItems = 0;
    let correctItems = 0;
    let gradedCount = 0;
    for (const it of topicItems) {
      const r = respByItem.get(it.id);
      if (!r) continue;
      completedItems++;
      if (it.item_type !== "fact") {
        gradedCount++;
        if (r.is_correct) correctItems++;
      }
    }
    const acc = gradedCount > 0 ? Math.round((correctItems / gradedCount) * 100) : null;
    return {
      topic,
      totalItems: topicItems.length,
      completedItems,
      correctItems,
      accuracyPct: acc,
      needsReview: acc !== null && acc < 75,
    };
  });

  const reviewTopics = topicStats.filter((t) => t.needsReview).map((t) => t.topic);
  const reviewItemIds = responses
    .filter((r) => !r.is_correct && itemById.get(r.item_id)?.item_type !== "fact")
    .map((r) => r.item_id);

  const factsRead = responses.filter((r) => itemById.get(r.item_id)?.item_type === "fact").length;
  const tacticsCorrect = responses.filter((r) => {
    const it = itemById.get(r.item_id);
    return (
      r.is_correct &&
      it &&
      ["singles_tactics", "doubles_tactics", "game_iq"].includes(it.topic)
    );
  }).length;
  const rulesCorrect = responses.filter(
    (r) => r.is_correct && itemById.get(r.item_id)?.topic === "rules",
  ).length;
  const topicsTouched = topicStats.filter((t) => t.completedItems > 0).length;
  const submittedTests = attempts.filter((a) => a.status === "submitted").length;

  const badges: AcademyBadgeProgress[] = [
    {
      code: "first_step",
      unlocked: responses.length >= 1,
      progressText: `${Math.min(1, responses.length)}/1`,
    },
    {
      code: "curious_shuttle",
      unlocked: factsRead >= 1 && responses.length >= 3,
      progressText: `${Math.min(3, responses.length)}/3`,
    },
    {
      code: "tactician",
      unlocked: tacticsCorrect >= 3,
      progressText: `${Math.min(3, tacticsCorrect)}/3`,
    },
    {
      code: "rules_umpire",
      unlocked: rulesCorrect >= 2,
      progressText: `${Math.min(2, rulesCorrect)}/2`,
    },
    {
      code: "all_rounder",
      unlocked: topicsTouched >= 6,
      progressText: `${ Math.min(6, topicsTouched)}/6`,
    },
    {
      code: "monthly_check",
      unlocked: submittedTests >= 1,
      progressText: `${Math.min(1, submittedTests)}/1`,
    },
  ];

  return {
    totalPoints,
    completedCount: responses.length,
    correctCount,
    accuracyPct,
    topicStats,
    reviewTopics,
    reviewItemIds,
    badges,
  };
}

export interface GroupTopicErrorStat {
  topic: AcademyTopic;
  totalAnswers: number;
  wrongAnswers: number;
  errorRatePct: number;
}

/** Coach analytics: ranks curriculum topics by group error rate so coaches know what to explain on court. */
export function computeGroupErrorAnalytics(
  items: readonly AcademyItem[],
  responses: readonly AcademyResponse[],
  attempts: readonly AcademyTestAttempt[],
): GroupTopicErrorStat[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const counts = new Map<AcademyTopic, { total: number; wrong: number }>();

  for (const r of responses) {
    const it = itemById.get(r.item_id);
    if (!it || it.item_type === "fact") continue;
    const cur = counts.get(it.topic) ?? { total: 0, wrong: 0 };
    cur.total++;
    if (!r.is_correct) cur.wrong++;
    counts.set(it.topic, cur);
  }

  for (const att of attempts) {
    if (att.status !== "submitted" || !att.topic_breakdown) continue;
    for (const [topicKey, br] of Object.entries(att.topic_breakdown)) {
      if (!ACADEMY_TOPICS.includes(topicKey as AcademyTopic)) continue;
      const t = topicKey as AcademyTopic;
      const cur = counts.get(t) ?? { total: 0, wrong: 0 };
      cur.total += br.total;
      cur.wrong += Math.max(0, br.total - br.correct);
      counts.set(t, cur);
    }
  }

  return ACADEMY_TOPICS.map((topic) => {
    const c = counts.get(topic) ?? { total: 0, wrong: 0 };
    return {
      topic,
      totalAnswers: c.total,
      wrongAnswers: c.wrong,
      errorRatePct: c.total > 0 ? Math.round((c.wrong / c.total) * 100) : 0,
    };
  }).sort((a, b) => b.errorRatePct - a.errorRatePct || b.totalAnswers - a.totalAnswers);
}

// ============================================================================
// AI Content Generator & Batch JSON Validator (for 1-click Coach AI workflow)
// ============================================================================

const localizedTextSchema = z.object({
  ru: z.string().min(1),
  en: z.string().min(1),
  ro: z.string().min(1),
});

const courtDiagramSchema = z
  .object({
    players: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        team: z.enum(["you", "opp"]),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      }),
    ),
    shuttle: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
      .optional(),
    arrows: z
      .array(
        z.object({
          from: z.tuple([z.number(), z.number()]),
          to: z.tuple([z.number(), z.number()]),
          label: z.string().min(1),
          tone: z.enum(["accent", "ok", "warn", "danger", "muted"]).optional(),
        }),
      )
      .optional(),
  })
  .nullable()
  .optional();

export const aiAcademyItemSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9_-]+$/i),
    item_type: z.enum([
      "fact",
      "single_choice",
      "multi_choice",
      "tactical",
      "find_mistake",
      "rules",
      "technique",
      "physical_recovery",
      "psychology",
      "visual_tactical",
    ]),
    topic: z.enum([
      "rules",
      "technique",
      "singles_tactics",
      "doubles_tactics",
      "game_iq",
      "footwork",
      "conditioning",
      "recovery_prevention",
      "psychology",
      "history_facts",
    ]),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
    min_age: z.number().int().min(6).max(25).default(10),
    max_age: z.number().int().min(6).max(25).default(17),
    title: localizedTextSchema,
    body: localizedTextSchema,
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          text: localizedTextSchema,
        }),
      )
      .min(1),
    correct_option_ids: z.array(z.string().min(1)).min(1),
    explanation: localizedTextSchema,
    source_ref: z.string().nullable().optional(),
    court_diagram: courtDiagramSchema,
    scheduled_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine(
    (item) => {
      const optIds = new Set(item.options.map((o) => o.id));
      return item.correct_option_ids.every((cid) => optIds.has(cid));
    },
    { message: "Every correct_option_id must match an existing option.id" },
  );

export const aiBatchPayloadSchema = z.object({
  items: z.array(aiAcademyItemSchema).min(1).max(40),
  test: z
    .object({
      code: z.string().min(3).max(80).regex(/^[a-z0-9_-]+$/i),
      title: localizedTextSchema,
      description: localizedTextSchema,
      difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
      time_limit_minutes: z.number().int().min(1).max(120).nullable().optional(),
      available_days: z.number().int().min(1).max(90).default(30),
      max_attempts: z.number().int().min(1).max(5).default(1),
    })
    .optional(),
});

export type AiBatchPayload = z.infer<typeof aiBatchPayloadSchema>;

/** Extracts JSON even if the user pasted markdown ```json fences from ChatGPT/Claude. */
export function parseAiAcademyPayload(
  raw: string,
): { ok: true; data: AiBatchPayload } | { ok: false; error: string } {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const normalized = Array.isArray(parsedJson) ? { items: parsedJson } : parsedJson;
  const res = aiBatchPayloadSchema.safeParse(normalized);
  if (!res.success) {
    const first = res.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join(".") || "root"}: ${first.message}`,
    };
  }
  return { ok: true, data: res.data };
}

/** Builds a ready-to-copy prompt for ChatGPT / Claude / Gemini so coaches can generate verified tasks in 10s. */
export function buildAiPromptForCoach(opts: {
  mode: "daily_pack" | "monthly_test" | "visual_tactics";
  topic: AcademyTopic | "all";
  difficulty: AcademyLevel;
  count: number;
}): string {
  const topicNote =
    opts.topic === "all"
      ? "Mix across topics: rules, technique, singles_tactics, doubles_tactics, game_iq, footwork, conditioning, recovery_prevention, psychology, history_facts."
      : `Focus on topic: "${opts.topic}".`;

  const modeNote =
    opts.mode === "monthly_test"
      ? `Generate ${opts.count} questions AND include a "test" object at the root so it creates a ready monthly test.`
      : opts.mode === "visual_tactics"
        ? `Generate ${opts.count} visual tactical problems (item_type: "visual_tactical") with a "court_diagram" object (x: 0..100 court width, y: 0..50 opponent half, y: 50..100 player half).`
        : `Generate ${opts.count} daily badminton learning tasks (mix of "fact", "tactical", "find_mistake", "rules", "single_choice", "multi_choice").`;

  return `You are a BWF-certified badminton coach and sports scientist creating educational tasks for youth badminton players (ages 10–17) in RallyMonitor Academy.

${modeNote}
Difficulty level: "${opts.difficulty}".
${topicNote}

STRICT RULES:
1. Use ONLY verified BWF Laws of Badminton, BWF Coach Education tactics, and peer-reviewed youth sports science. Never invent rules or dubious facts.
2. Provide COMPLETE, natural translations in all 3 languages: Russian ("ru"), English ("en"), and Romanian ("ro").
3. Return ONLY valid JSON (no markdown commentary) matching this exact schema:

{
  "items": [
    {
      "code": "unique_snake_case_code_01",
      "item_type": "tactical",
      "topic": "${opts.topic === "all" ? "singles_tactics" : opts.topic}",
      "difficulty": "${opts.difficulty}",
      "min_age": 10,
      "max_age": 17,
      "title": { "ru": "...", "en": "...", "ro": "..." },
      "body": { "ru": "...", "en": "...", "ro": "..." },
      "options": [
        { "id": "a", "text": { "ru": "...", "en": "...", "ro": "..." } },
        { "id": "b", "text": { "ru": "...", "en": "...", "ro": "..." } },
        { "id": "c", "text": { "ru": "...", "en": "...", "ro": "..." } }
      ],
      "correct_option_ids": ["a"],
      "explanation": { "ru": "...", "en": "...", "ro": "..." },
      "source_ref": "BWF Laws of Badminton / BWF Coach Level 1",
      "court_diagram": ${
        opts.mode === "visual_tactics"
          ? `{
        "players": [
          { "id": "you", "label": "YOU", "team": "you", "x": 75, "y": 65 },
          { "id": "opp", "label": "OPP", "team": "opp", "x": 72, "y": 35 }
        ],
        "shuttle": { "x": 75, "y": 58 },
        "arrows": [
          { "from": [75, 58], "to": [22, 14], "label": "A", "tone": "accent" },
          { "from": [75, 58], "to": [74, 36], "label": "B", "tone": "muted" }
        ]
      }`
          : "null"
      }
    }
  ]${
    opts.mode === "monthly_test"
      ? `,
  "test": {
    "code": "monthly_test_${opts.difficulty}_01",
    "title": { "ru": "Месячный тест...", "en": "Monthly test...", "ro": "Test lunar..." },
    "description": { "ru": "...", "en": "...", "ro": "..." },
    "difficulty": "${opts.difficulty}",
    "time_limit_minutes": 12,
    "available_days": 30,
    "max_attempts": 2
  }`
      : ""
  }
}`;
}
