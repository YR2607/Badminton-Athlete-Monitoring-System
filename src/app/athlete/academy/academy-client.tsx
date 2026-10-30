"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  saveAcademyTestDraft,
  startOrResumeAcademyTest,
  submitAcademyAnswer,
  submitAcademyTest,
} from "@/app/actions/academy";
import {
  ACADEMY_TOPICS,
  localizeText,
  monthLessonStats,
  testWindowStatus,
  type AthleteAcademySummary,
} from "@/lib/academy";
import { TacticalCourtDiagram } from "@/components/academy/tactical-court";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AcademyLevel,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
  AcademyTopic,
  Locale,
  PublicAcademyItem,
} from "@/lib/types";

type TabKey = "today" | "topics" | "tests" | "badges";

export function AcademyClient({
  dict,
  locale,
  today,
  level,
  dailyItems,
  catalog,
  responses,
  tests,
  attempts,
  progress,
}: {
  dict: Dictionary;
  locale: Locale;
  today: string;
  level: AcademyLevel;
  dailyItems: PublicAcademyItem[];
  catalog: PublicAcademyItem[];
  responses: AcademyResponse[];
  tests: AcademyTest[];
  attempts: AcademyTestAttempt[];
  progress: AthleteAcademySummary;
}) {
  const router = useRouter();
  const a = dict.academy;
  const [tab, setTab] = useState<TabKey>("today");
  const [activeTopic, setActiveTopic] = useState<AcademyTopic | null>(null);

  // Local map of answered items (seeded from server responses, updated on submit).
  const [revealedById, setRevealedById] = useState<Record<string, PublicAcademyItem>>(() => {
    const m: Record<string, PublicAcademyItem> = {};
    for (const it of [...dailyItems, ...catalog]) {
      if (it.correct_option_ids !== null) m[it.id] = it;
    }
    return m;
  });
  const [respByItem, setRespByItem] = useState<
    Record<string, { selected: string[]; isCorrect: boolean; points: number }>
  >(() => {
    const m: Record<string, { selected: string[]; isCorrect: boolean; points: number }> = {};
    for (const r of responses) {
      m[r.item_id] = {
        selected: r.selected_option_ids,
        isCorrect: r.is_correct,
        points: r.points_awarded,
      };
    }
    return m;
  });
  const [selectedOpts, setSelectedOpts] = useState<Record<string, string[]>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Monthly test player state
  const [activeAttempt, setActiveAttempt] = useState<AcademyTestAttempt | null>(null);
  const [testQuestions, setTestQuestions] = useState<PublicAcademyItem[]>([]);
  const [testAnswers, setTestAnswers] = useState<Record<string, string[]>>({});
  const [testBusy, setTestBusy] = useState(false);
  const [elapsedTickSec, setElapsedTickSec] = useState<number>(0);

  const activeTestMeta = activeAttempt
    ? tests.find((t) => t.id === activeAttempt.test_id) ?? null
    : null;

  // "Lessons N of M days this month" counter — the monthly test lands on
  // the last day of the month.
  const month = monthLessonStats(responses, today);
  const monthPct = Math.min(100, Math.round((month.daysDone / month.daysElapsed) * 100));

  // Countdown timer for active in-progress monthly test
  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "in_progress" || !activeTestMeta?.time_limit_minutes) {
      return;
    }
    const startedMs = new Date(activeAttempt.started_at).getTime();
    const id = window.setInterval(() => {
      setElapsedTickSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [activeAttempt, activeTestMeta]);

  const remainingSec =
    activeAttempt &&
    activeAttempt.status === "in_progress" &&
    activeTestMeta?.time_limit_minutes
      ? Math.max(0, activeTestMeta.time_limit_minutes * 60 - elapsedTickSec)
      : null;

  function toggleOption(itemId: string, optId: string, multi: boolean) {
    setSelectedOpts((prev) => {
      const cur = prev[itemId] ?? [];
      if (!multi) return { ...prev, [itemId]: [optId] };
      return {
        ...prev,
        [itemId]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId],
      };
    });
  }

  async function handleAnswer(item: PublicAcademyItem) {
    if (submittingId) return;
    const chosen =
      item.item_type === "fact"
        ? [item.options[0]?.id ?? "ack"]
        : (selectedOpts[item.id] ?? []);
    if (chosen.length === 0) return;

    setSubmittingId(item.id);
    const res = await submitAcademyAnswer({
      itemId: item.id,
      selectedOptionIds: chosen,
      durationSec: 15,
    });
    setSubmittingId(null);

    if (!res.ok || !res.revealedItem) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    setRevealedById((prev) => ({ ...prev, [item.id]: res.revealedItem! }));
    setRespByItem((prev) => ({
      ...prev,
      [item.id]: {
        selected: chosen,
        isCorrect: Boolean(res.isCorrect),
        points: res.pointsAwarded ?? 0,
      },
    }));
    if (res.isCorrect) {
      toast.success(a.correctMsg.replace("{xp}", String(res.pointsAwarded ?? 10)));
    } else {
      toast.message(a.wrongMsg.replace("{xp}", String(res.pointsAwarded ?? 3)));
    }
    router.refresh();
  }

  async function handleStartTest(testId: string) {
    if (testBusy) return;
    setTestBusy(true);
    const res = await startOrResumeAcademyTest(testId);
    setTestBusy(false);
    if (!res.ok || !res.attempt || !res.questions) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    setActiveAttempt(res.attempt);
    setTestQuestions(res.questions);
    setTestAnswers(res.attempt.draft_answers ?? {});
  }

  function toggleTestAnswer(q: PublicAcademyItem, optId: string) {
    const multi = q.item_type === "multi_choice";
    const next = (() => {
      const cur = testAnswers[q.id] ?? [];
      if (!multi) return { ...testAnswers, [q.id]: [optId] };
      return {
        ...testAnswers,
        [q.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId],
      };
    })();
    setTestAnswers(next);
    if (activeAttempt && activeAttempt.status === "in_progress") {
      void saveAcademyTestDraft({ attemptId: activeAttempt.id, draftAnswers: next });
    }
  }

  async function handleFinishTest() {
    if (!activeAttempt || testBusy) return;
    setTestBusy(true);
    const res = await submitAcademyTest({
      attemptId: activeAttempt.id,
      answers: testAnswers,
    });
    setTestBusy(false);
    if (!res.ok || !res.attempt || !res.revealedQuestions) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    setActiveAttempt(res.attempt);
    setTestQuestions(res.revealedQuestions);
    toast.success(
      a.testScore
        .replace("{s}", String(res.attempt.score_pct ?? 0))
        .replace("{c}", String(res.attempt.correct_count))
        .replace("{t}", String(res.attempt.total_count)),
    );
    router.refresh();
  }

  function renderCard(rawItem: PublicAcademyItem, stepLabel?: string) {
    const item = revealedById[rawItem.id] ?? rawItem;
    const ans = respByItem[item.id];
    const isDone = Boolean(ans);
    const isMulti = item.item_type === "multi_choice";
    const currentSelected = isDone ? ans.selected : (selectedOpts[item.id] ?? []);

    return (
      <Card key={item.id} className={cn(isDone && "border-ok/30")}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {stepLabel && <Badge tone="accent">{stepLabel}</Badge>}
              <Badge tone="neutral">{a.topics[item.topic]}</Badge>
              <Badge tone="neutral">{a.levels[item.difficulty]}</Badge>
            </div>
            {isDone && (
              <Badge tone={ans.isCorrect ? "ok" : "warn"}>
                {ans.isCorrect
                  ? a.correctMsg.replace("{xp}", String(ans.points))
                  : `+${ans.points} XP`}
              </Badge>
            )}
          </div>
          <CardTitle className="pt-1 text-base">{localizeText(item.title, locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed">{localizeText(item.body, locale)}</p>

          {item.court_diagram && <TacticalCourtDiagram diagram={item.court_diagram} />}

          {item.item_type === "fact" ? (
            !isDone && (
              <Button
                size="sm"
                disabled={submittingId === item.id}
                onClick={() => void handleAnswer(item)}
              >
                ✓ {a.markRead}
              </Button>
            )
          ) : (
            <div className="space-y-2">
              {isMulti && !isDone && (
                <p className="text-xs text-muted">ℹ️ {a.multiHint}</p>
              )}
              <div className="space-y-1.5">
                {item.options.map((opt) => {
                  const chosen = currentSelected.includes(opt.id);
                  const isCorrectOpt = item.correct_option_ids?.includes(opt.id) ?? false;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isDone || submittingId === item.id}
                      onClick={() => toggleOption(item.id, opt.id, isMulti)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl border p-3 text-left text-sm transition-colors",
                        isDone
                          ? isCorrectOpt
                            ? "border-ok bg-ok/10 font-medium text-foreground"
                            : chosen
                              ? "border-danger/60 bg-danger/10 text-foreground"
                              : "border-border/60 bg-surface text-muted"
                          : chosen
                            ? "border-accent bg-accent/10 font-medium text-foreground"
                            : "border-border bg-surface hover:border-accent/40",
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-xs font-bold uppercase text-muted">
                        {isDone ? (isCorrectOpt ? "✅" : chosen ? "❌" : "•") : chosen ? "●" : "○"}
                      </span>
                      <span className="flex-1">{localizeText(opt.text, locale)}</span>
                    </button>
                  );
                })}
              </div>
              {!isDone && (
                <Button
                  size="sm"
                  disabled={currentSelected.length === 0 || submittingId === item.id}
                  onClick={() => void handleAnswer(item)}
                >
                  {a.checkAnswer}
                </Button>
              )}
            </div>
          )}

          {isDone && item.explanation && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground">💡 {a.explanationTitle}</p>
              <p className="text-muted leading-relaxed">{localizeText(item.explanation, locale)}</p>
              {item.source_ref && (
                <p className="text-[11px] text-muted/80">
                  📚 {a.sourceLabel}: {item.source_ref}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const dailyDoneCount = dailyItems.filter((it) => Boolean(respByItem[it.id])).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">🎓 {a.title}</h1>
          <p className="text-sm text-muted">{a.subtitle}</p>
        </div>
        <Badge tone="accent">
          {a.levelLabel}: {a.levels[level]}
        </Badge>
      </div>

      {/* Summary KPI tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-accent tabular-nums">{progress.totalPoints}</p>
            <p className="text-xs text-muted">{a.pointsLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">{progress.completedCount}</p>
            <p className="text-xs text-muted">{a.completedLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-ok tabular-nums">
              {progress.accuracyPct !== null ? `${progress.accuracyPct}%` : "—"}
            </p>
            <p className="text-xs text-muted">{a.accuracyLabel}</p>
          </CardContent>
        </Card>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5">
        {(
          [
            ["today", `${a.tabToday} (${dailyDoneCount}/${dailyItems.length})`],
            ["topics", a.tabTopics],
            ["tests", `${a.tabTests} (${tests.length})`],
            ["badges", a.tabBadges],
          ] as [TabKey, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === k
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: DAILY LESSON */}
      {tab === "today" && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {a.dailyTitle} · {today} — {a.dailyHint}
          </p>
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  📆{" "}
                  {a.monthProgress
                    .replace("{done}", String(month.daysDone))
                    .replace("{elapsed}", String(month.daysElapsed))
                    .replace("{total}", String(month.daysInMonth))}
                </span>
                <span className="text-muted">
                  🏁 {a.monthTestInfo.replace("{date}", month.lastDay)}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-foreground/10"
                role="progressbar"
                aria-valuenow={monthPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${monthPct}%` }}
                />
              </div>
            </CardContent>
          </Card>
          {dailyItems.map((it, idx) =>
            renderCard(
              it,
              it.item_type === "fact"
                ? `1. ${a.stepFact}`
                : idx === 1
                  ? `2. ${a.stepTactics}`
                  : `3. ${a.stepQuiz}`,
            ),
          )}
        </div>
      )}

      {/* TAB 2: TOPICS, PROGRESS & REVIEW */}
      {tab === "topics" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">🔁 {a.reviewBoxTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {progress.reviewTopics.length === 0 ? (
                <p className="text-xs text-ok">✓ {a.reviewBoxEmpty}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {progress.reviewTopics.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setActiveTopic(t)}
                      className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs font-medium text-warn"
                    >
                      ⚠️ {a.topics[t]}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {ACADEMY_TOPICS.map((topic) => {
              const st = progress.topicStats.find((x) => x.topic === topic);
              const done = st?.completedItems ?? 0;
              const tot = st?.totalItems ?? 0;
              const pct = tot > 0 ? Math.round((done / tot) * 100) : 0;
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => setActiveTopic(activeTopic === topic ? null : topic)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    activeTopic === topic
                      ? "border-accent bg-accent/5"
                      : "border-border bg-surface hover:border-accent/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{a.topics[topic]}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {done}/{tot}
                      {st?.accuracyPct !== null && st?.accuracyPct !== undefined
                        ? ` · ${st.accuracyPct}%`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {activeTopic && (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold">
                {a.topics[activeTopic]} ({catalog.filter((c) => c.topic === activeTopic).length})
              </h3>
              {catalog
                .filter((c) => c.topic === activeTopic)
                .map((it) => renderCard(it))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MONTHLY TESTS */}
      {tab === "tests" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-foreground/[0.02] p-3 text-xs text-muted">
            ℹ️ {a.monthlyDisclaimer}
          </div>

          {activeAttempt ? (
            <div className="space-y-4">
              <Card className="border-accent/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4">
                  <div>
                    <p className="font-semibold">
                      {activeTestMeta ? localizeText(activeTestMeta.title, locale) : a.monthlyTitle}
                    </p>
                    {activeAttempt.status === "submitted" && (
                      <p className="text-sm text-ok font-medium">
                        {a.testScore
                          .replace("{s}", String(activeAttempt.score_pct ?? 0))
                          .replace("{c}", String(activeAttempt.correct_count))
                          .replace("{t}", String(activeAttempt.total_count))}
                      </p>
                    )}
                  </div>
                  {activeAttempt.status === "in_progress" && remainingSec !== null && (
                    <Badge tone={remainingSec < 60 ? "danger" : "accent"}>
                      ⏱ {a.timeLeft}: {Math.floor(remainingSec / 60)}:
                      {String(remainingSec % 60).padStart(2, "0")}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              {testQuestions.map((q, idx) => {
                const submitted = activeAttempt.status !== "in_progress";
                const chosen = submitted
                  ? (activeAttempt.final_answers[q.id] ?? [])
                  : (testAnswers[q.id] ?? []);
                return (
                  <Card key={q.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="neutral">
                          #{idx + 1} · {a.topics[q.topic]}
                        </Badge>
                        {q.item_type === "multi_choice" && !submitted && (
                          <span className="text-xs text-muted">{a.multiHint}</span>
                        )}
                      </div>
                      <CardTitle className="pt-1 text-base">
                        {localizeText(q.title, locale)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm">{localizeText(q.body, locale)}</p>
                      {q.court_diagram && <TacticalCourtDiagram diagram={q.court_diagram} />}
                      <div className="space-y-1.5">
                        {q.options.map((opt) => {
                          const isPicked = chosen.includes(opt.id);
                          const isRight = q.correct_option_ids?.includes(opt.id) ?? false;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={submitted}
                              onClick={() => toggleTestAnswer(q, opt.id)}
                              className={cn(
                                "flex w-full items-start gap-2.5 rounded-xl border p-3 text-left text-sm",
                                submitted
                                  ? isRight
                                    ? "border-ok bg-ok/10 font-medium"
                                    : isPicked
                                      ? "border-danger bg-danger/10"
                                      : "border-border/60 text-muted"
                                  : isPicked
                                    ? "border-accent bg-accent/10 font-medium"
                                    : "border-border hover:border-accent/40",
                              )}
                            >
                              <span className="mt-0.5 text-xs font-bold">
                                {submitted ? (isRight ? "✅" : isPicked ? "❌" : "•") : isPicked ? "●" : "○"}
                              </span>
                              <span>{localizeText(opt.text, locale)}</span>
                            </button>
                          );
                        })}
                      </div>
                      {submitted && q.explanation && (
                        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-xs">
                          <p className="font-semibold">💡 {a.explanationTitle}</p>
                          <p className="mt-0.5 text-muted">{localizeText(q.explanation, locale)}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {activeAttempt.status === "in_progress" ? (
                <Button
                  size="lg"
                  className="w-full"
                  disabled={testBusy}
                  onClick={() => void handleFinishTest()}
                >
                  {a.submitTestBtn}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setActiveAttempt(null);
                    setTestQuestions([]);
                  }}
                >
                  ← {a.monthlyTitle}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {tests.map((t) => {
                const myAttempts = attempts.filter((at) => at.test_id === t.id);
                const inProg = myAttempts.find((at) => at.status === "in_progress");
                const bestSub = myAttempts
                  .filter((at) => at.status === "submitted")
                  .sort((x, y) => (y.score_pct ?? 0) - (x.score_pct ?? 0))[0];
                const win = testWindowStatus(t, today);
                const canStart =
                  (win.status === "open" || Boolean(inProg)) &&
                  (Boolean(inProg) || myAttempts.length < t.max_attempts);

                return (
                  <Card key={t.id}>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">
                          {localizeText(t.title, locale)}
                        </CardTitle>
                        <div className="flex gap-1.5">
                          <Badge tone="neutral">
                            {a.questionsCount.replace("{n}", String(t.question_count))}
                          </Badge>
                          {t.time_limit_minutes && (
                            <Badge tone="neutral">
                              ⏱ {a.timeLimitMin.replace("{m}", String(t.time_limit_minutes))}
                            </Badge>
                          )}
                          <Badge tone="neutral">
                            {a.attemptsUsed
                              .replace("{u}", String(myAttempts.length))
                              .replace("{m}", String(t.max_attempts))}
                          </Badge>
                          <Badge
                            tone={
                              win.status === "open"
                                ? "ok"
                                : win.status === "upcoming"
                                  ? "warn"
                                  : "neutral"
                            }
                            title={a.testWindow
                              .replace("{from}", t.available_from)
                              .replace("{until}", t.available_until)}
                          >
                            {win.status === "open"
                              ? `📅 ${t.available_until}`
                              : win.status === "upcoming"
                                ? a.testOpensIn.replace("{d}", String(win.daysUntil))
                                : a.testClosed}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted">{localizeText(t.description, locale)}</p>
                      {bestSub && (
                        <p className="text-xs font-semibold text-ok">
                          ✓{" "}
                          {a.testScore
                            .replace("{s}", String(bestSub.score_pct ?? 0))
                            .replace("{c}", String(bestSub.correct_count))
                            .replace("{t}", String(bestSub.total_count))}
                        </p>
                      )}
                      {canStart && (
                        <Button
                          size="sm"
                          disabled={testBusy}
                          onClick={() => void handleStartTest(t.id)}
                        >
                          {inProg ? a.continueTestBtn : a.startTestBtn}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ACHIEVEMENTS */}
      {tab === "badges" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {progress.badges.map((b) => {
            const meta = a.badges[b.code];
            return (
              <Card
                key={b.code}
                className={cn(b.unlocked ? "border-ok/40 bg-ok/5" : "opacity-75")}
              >
                <CardContent className="flex items-start justify-between gap-3 pt-4">
                  <div>
                    <p className="text-sm font-semibold">
                      {b.unlocked ? "🏅 " : "🔒 "}
                      {meta.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{meta.desc}</p>
                  </div>
                  <Badge tone={b.unlocked ? "ok" : "neutral"}>
                    {b.unlocked ? "✓" : b.progressText}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
