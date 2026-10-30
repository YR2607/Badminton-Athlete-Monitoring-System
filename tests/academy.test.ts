import { describe, expect, it } from "vitest";
import {
  buildAiPromptForCoach,
  computeAthleteAcademyProgress,
  computeGroupErrorAnalytics,
  computeLibraryItemStats,
  gradeAcademyAnswer,
  gradeTestAttempt,
  isAttemptExpired,
  localizeText,
  monthLessonStats,
  parseAiAcademyPayload,
  testWindowStatus,
  redactAcademyItem,
  selectDailyLesson,
  selectMonthlyReviewQuestionIds,
} from "@/lib/academy";
import type {
  AcademyItem,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
} from "@/lib/types";

const mkItem = (overrides: Partial<AcademyItem> = {}): AcademyItem => ({
  id: overrides.id ?? "item-1",
  code: overrides.code ?? "code_1",
  item_type: overrides.item_type ?? "single_choice",
  topic: overrides.topic ?? "rules",
  difficulty: overrides.difficulty ?? "beginner",
  min_age: 10,
  max_age: 17,
  title: overrides.title ?? { ru: "Заголовок", en: "Title", ro: "Titlu" },
  body: overrides.body ?? { ru: "Вопрос", en: "Question", ro: "Întrebare" },
  options: overrides.options ?? [
    { id: "a", text: { ru: "А", en: "A", ro: "A" } },
    { id: "b", text: { ru: "Б", en: "B", ro: "B" } },
    { id: "c", text: { ru: "В", en: "C", ro: "C" } },
  ],
  correct_option_ids: overrides.correct_option_ids ?? ["a"],
  explanation: overrides.explanation ?? {
    ru: "Объяснение",
    en: "Explanation",
    ro: "Explicație",
  },
  source_ref: overrides.source_ref ?? "BWF Law 9.1",
  court_diagram: overrides.court_diagram ?? null,
  scheduled_date: overrides.scheduled_date ?? null,
  target_group_id: overrides.target_group_id ?? null,
  published: overrides.published ?? true,
  created_by: null,
  created_at: "2026-10-01T00:00:00Z",
});

describe("Academy — secret redaction before completion", () => {
  it("hides correct_option_ids, explanation and source_ref when revealSecrets is false", () => {
    const item = mkItem();
    const redacted = redactAcademyItem(item, false, "seed-1");
    expect(redacted.correct_option_ids).toBeNull();
    expect(redacted.explanation).toBeNull();
    expect(redacted.source_ref).toBeNull();
    expect(redacted.options.length).toBe(3);
  });

  it("reveals correct_option_ids and explanation only after completion", () => {
    const item = mkItem();
    const revealed = redactAcademyItem(item, true);
    expect(revealed.correct_option_ids).toEqual(["a"]);
    expect(revealed.explanation?.en).toBe("Explanation");
    expect(revealed.source_ref).toBe("BWF Law 9.1");
  });
});

describe("Academy — answer grading", () => {
  it("grades single-choice and multi-choice accurately", () => {
    const single = mkItem({ difficulty: "intermediate", correct_option_ids: ["b"] });
    expect(gradeAcademyAnswer(single, ["b"])).toEqual({ isCorrect: true, points: 15 });
    expect(gradeAcademyAnswer(single, ["a"])).toEqual({ isCorrect: false, points: 3 });

    const multi = mkItem({
      item_type: "multi_choice",
      difficulty: "advanced",
      correct_option_ids: ["a", "c"],
    });
    expect(gradeAcademyAnswer(multi, ["c", "a"])).toEqual({ isCorrect: true, points: 20 });
    expect(gradeAcademyAnswer(multi, ["a"])).toEqual({ isCorrect: false, points: 3 });
    expect(gradeAcademyAnswer(multi, ["a", "b", "c"])).toEqual({ isCorrect: false, points: 3 });
  });

  it("awards 5 XP for reading a daily fact", () => {
    const fact = mkItem({ item_type: "fact", correct_option_ids: ["ack"] });
    expect(gradeAcademyAnswer(fact, ["ack"])).toEqual({ isCorrect: true, points: 5 });
  });
});

describe("Academy — daily lesson assignment", () => {
  it("prioritizes calendar-scheduled items for today and caps daily set at 3 cards without backlog penalties", () => {
    const items: AcademyItem[] = [
      mkItem({ id: "f1", code: "f1", item_type: "fact", topic: "history_facts" }),
      mkItem({ id: "t1", code: "t1", item_type: "tactical", topic: "singles_tactics" }),
      mkItem({ id: "q1", code: "q1", item_type: "rules", topic: "rules" }),
      mkItem({
        id: "sched-today",
        code: "sched",
        item_type: "visual_tactical",
        topic: "doubles_tactics",
        scheduled_date: "2026-10-28",
      }),
      mkItem({ id: "unpub", code: "unpub", published: false, scheduled_date: "2026-10-28" }),
    ];

    const lesson = selectDailyLesson(items, [], {
      athleteId: "ath-1",
      today: "2026-10-28",
      level: "beginner",
    });

    expect(lesson.length).toBe(3);
    expect(lesson.some((i) => i.id === "sched-today")).toBe(true);
    expect(lesson.some((i) => i.id === "unpub")).toBe(false);
  });
});

describe("Academy — localization & fallback tags", () => {
  it("returns exact language text and explicitly marks fallback if a language is missing", () => {
    const full = { ru: "Правила", en: "Rules", ro: "Reguli" };
    expect(localizeText(full, "ru")).toBe("Правила");
    expect(localizeText(full, "en")).toBe("Rules");
    expect(localizeText(full, "ro")).toBe("Reguli");
    expect(localizeText({ ru: "", en: "Service height", ro: "" }, "ro")).toBe("[EN] Service height");
  });
});

describe("Academy — monthly test grading, expiry & unfinished attempts", () => {
  it("grades test uniformly and computes per-topic breakdown", () => {
    const q1 = mkItem({ id: "q1", topic: "rules", correct_option_ids: ["a"] });
    const q2 = mkItem({
      id: "q2",
      topic: "doubles_tactics",
      item_type: "multi_choice",
      correct_option_ids: ["a", "b"],
    });
    const res = gradeTestAttempt([q1, q2], {
      q1: ["a"],
      q2: ["a"], // missing 'b'
    });
    expect(res.totalCount).toBe(2);
    expect(res.correctCount).toBe(1);
    expect(res.scorePct).toBe(50);
    expect(res.topicBreakdown.rules).toEqual({ correct: 1, total: 1 });
    expect(res.topicBreakdown.doubles_tactics).toEqual({ correct: 0, total: 1 });
  });

  it("detects expired attempts by time limit or closing date", () => {
    const test: Pick<AcademyTest, "time_limit_minutes" | "available_until"> = {
      time_limit_minutes: 10,
      available_until: "2026-10-31",
    };
    const started20MinAgo: Pick<AcademyTestAttempt, "started_at" | "status"> = {
      started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      status: "in_progress",
    };
    expect(isAttemptExpired(started20MinAgo, test, new Date(), "2026-10-28")).toBe(true);

    const freshAttempt: Pick<AcademyTestAttempt, "started_at" | "status"> = {
      started_at: new Date().toISOString(),
      status: "in_progress",
    };
    expect(isAttemptExpired(freshAttempt, test, new Date(), "2026-10-28")).toBe(false);
    expect(isAttemptExpired(freshAttempt, test, new Date(), "2026-11-02")).toBe(true);
  });
});

describe("Academy — progress, achievements & group error analytics", () => {
  it("computes XP without retry farming, flags topics needing review, and ranks group error hotspots", () => {
    const items = [
      mkItem({ id: "r1", topic: "rules", item_type: "rules" }),
      mkItem({ id: "t1", topic: "singles_tactics", item_type: "tactical" }),
    ];
    const responses: AcademyResponse[] = [
      {
        id: "resp-1",
        athlete_id: "ath-1",
        item_id: "r1",
        assigned_date: "2026-10-28",
        selected_option_ids: ["b"],
        is_correct: false,
        points_awarded: 3,
        duration_sec: 12,
        completed_at: "2026-10-28T10:00:00Z",
      },
      {
        id: "resp-2",
        athlete_id: "ath-1",
        item_id: "t1",
        assigned_date: "2026-10-28",
        selected_option_ids: ["a"],
        is_correct: true,
        points_awarded: 10,
        duration_sec: 15,
        completed_at: "2026-10-28T10:01:00Z",
      },
    ];
    const attempts: AcademyTestAttempt[] = [
      {
        id: "att-1",
        test_id: "test-1",
        athlete_id: "ath-1",
        attempt_number: 1,
        question_order: ["r1", "t1"],
        draft_answers: {},
        final_answers: {},
        score_pct: 80,
        correct_count: 8,
        total_count: 10,
        topic_breakdown: { rules: { correct: 0, total: 2 } },
        status: "submitted",
        started_at: "2026-10-28T10:00:00Z",
        submitted_at: "2026-10-28T10:05:00Z",
      },
      // Second submitted attempt on the SAME test must not award another 25 XP
      {
        id: "att-2",
        test_id: "test-1",
        athlete_id: "ath-1",
        attempt_number: 2,
        question_order: ["r1", "t1"],
        draft_answers: {},
        final_answers: {},
        score_pct: 90,
        correct_count: 9,
        total_count: 10,
        topic_breakdown: {},
        status: "submitted",
        started_at: "2026-10-28T11:00:00Z",
        submitted_at: "2026-10-28T11:05:00Z",
      },
    ];

    const summary = computeAthleteAcademyProgress(items, responses, attempts);
    expect(summary.totalPoints).toBe(3 + 10 + 25);
    expect(summary.reviewTopics).toContain("rules");
    expect(summary.badges.find((b) => b.code === "first_step")?.unlocked).toBe(true);
    expect(summary.badges.find((b) => b.code === "monthly_check")?.unlocked).toBe(true);

    const groupErrors = computeGroupErrorAnalytics(items, responses, attempts);
    expect(groupErrors[0].topic).toBe("rules");
    expect(groupErrors[0].errorRatePct).toBe(100);
  });
});

describe("Academy — AI prompt builder & batch JSON validator", () => {
  it("parses valid AI JSON (including markdown code fences) and rejects invalid option references", () => {
    const prompt = buildAiPromptForCoach({
      mode: "visual_tactics",
      topic: "doubles_tactics",
      difficulty: "intermediate",
      count: 3,
    });
    expect(prompt).toContain("visual_tactical");

    const fenced = "```json\n" + JSON.stringify({
      items: [
        {
          code: "ai_test_item_01",
          item_type: "tactical",
          topic: "doubles_tactics",
          difficulty: "intermediate",
          title: { ru: "Тест", en: "Test", ro: "Test" },
          body: { ru: "Вопрос", en: "Body", ro: "Corp" },
          options: [
            { id: "a", text: { ru: "Да", en: "Yes", ro: "Da" } },
            { id: "b", text: { ru: "Нет", en: "No", ro: "Nu" } },
          ],
          correct_option_ids: ["a"],
          explanation: { ru: "Потому что", en: "Because", ro: "Deoarece" },
        },
      ],
    }) + "\n```";

    const parsed = parseAiAcademyPayload(fenced);
    expect(parsed.ok).toBe(true);

    const bad = parseAiAcademyPayload(
      JSON.stringify({
        items: [
          {
            code: "bad_item",
            item_type: "tactical",
            topic: "rules",
            title: { ru: "Т", en: "T", ro: "T" },
            body: { ru: "В", en: "B", ro: "C" },
            options: [{ id: "a", text: { ru: "1", en: "1", ro: "1" } }],
            correct_option_ids: ["non_existent_option"],
            explanation: { ru: "О", en: "E", ro: "E" },
          },
        ],
      }),
    );
    expect(bad.ok).toBe(false);
  });
});

describe("monthLessonStats", () => {
  it("counts distinct lesson days in the current month only", () => {
    const responses = [
      { assigned_date: "2026-10-02" },
      { assigned_date: "2026-10-02" },
      { assigned_date: "2026-10-15" },
      { assigned_date: "2026-09-30" }, // previous month — ignored
      { assigned_date: "2026-11-01" }, // future day of next month — ignored
    ];
    const s = monthLessonStats(responses, "2026-10-30");
    expect(s.daysDone).toBe(2);
    expect(s.daysElapsed).toBe(30);
    expect(s.daysInMonth).toBe(31);
    expect(s.lastDay).toBe("2026-10-31");
  });

  it("handles February and empty responses", () => {
    const s = monthLessonStats([], "2026-02-10");
    expect(s).toMatchObject({ daysDone: 0, daysElapsed: 10, daysInMonth: 28, lastDay: "2026-02-28" });
  });
});

describe("testWindowStatus", () => {
  const t = { available_from: "2026-10-28", available_until: "2026-11-02" };
  it("reports upcoming with a day countdown", () => {
    expect(testWindowStatus(t, "2026-10-26")).toEqual({ status: "upcoming", daysUntil: 2 });
  });
  it("reports open inside the window (inclusive)", () => {
    expect(testWindowStatus(t, "2026-10-28").status).toBe("open");
    expect(testWindowStatus(t, "2026-11-02").status).toBe("open");
  });
  it("reports closed after the window", () => {
    expect(testWindowStatus(t, "2026-11-03").status).toBe("closed");
  });
});

describe("computeLibraryItemStats & selectMonthlyReviewQuestionIds", () => {
  it("tracks shown-this-month, reserve items, and builds monthly test from this month's questions", () => {
    const items: AcademyItem[] = [
      mkItem({ id: "q-month", item_type: "tactical" }),
      mkItem({ id: "q-sched", item_type: "rules", scheduled_date: "2026-10-12" }),
      mkItem({ id: "q-reserve", item_type: "single_choice" }),
      mkItem({ id: "f-1", item_type: "fact", options: [], correct_option_ids: [] }),
    ];
    const responses = [
      {
        item_id: "q-month",
        athlete_id: "ath-1",
        is_correct: true,
        assigned_date: "2026-10-05",
      },
      {
        item_id: "q-month",
        athlete_id: "ath-2",
        is_correct: false,
        assigned_date: "2026-10-06",
      },
    ];

    const stats = computeLibraryItemStats(items, responses, "2026-10-30");
    expect(stats.totalItems).toBe(4);
    expect(stats.quizItems).toBe(3);
    expect(stats.factItems).toBe(1);
    expect(stats.usedThisMonthCount).toBe(2); // q-month + q-sched
    expect(stats.unusedReserveCount).toBe(2); // q-reserve + f-1
    expect(stats.byItemId["q-month"].answeredByCount).toBe(2);
    expect(stats.byItemId["q-month"].accuracyPct).toBe(50);

    const review = selectMonthlyReviewQuestionIds(items, responses, "2026-10-30", 2);
    expect(review.questionIds).toEqual(["q-month", "q-sched"]);
    expect(review.fromThisMonthCount).toBe(2);

    const prompt = buildAiPromptForCoach({
      mode: "daily_pack",
      topic: "rules",
      difficulty: "beginner",
      count: 3,
      existingTitles: ["Подача по диагонали"],
    });
    expect(prompt).toContain("Подача по диагонали");
  });
});
