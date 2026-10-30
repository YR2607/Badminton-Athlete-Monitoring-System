"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  createMonthlyReviewTest,
  deleteAcademyItem,
  importAiAcademyBatch,
  setAthleteAcademyLevel,
  toggleAcademyItemPublished,
} from "@/app/actions/academy";
import {
  ACADEMY_LEVELS,
  ACADEMY_TOPICS,
  buildAiPromptForCoach,
  computeLibraryItemStats,
  localizeText,
  parseAiAcademyPayload,
  type AiBatchPayload,
  type GroupTopicErrorStat,
} from "@/lib/academy";
import { TacticalCourtDiagram } from "@/components/academy/tactical-court";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  AcademyItem,
  AcademyLevel,
  AcademyResponse,
  AcademyTest,
  AcademyTestAttempt,
  AcademyTopic,
  Group,
  Locale,
} from "@/lib/types";

export interface CoachAthleteAcademyRow {
  id: string;
  name: string;
  code: string;
  level: AcademyLevel;
  xp: number;
  completedCount: number;
  accuracyPct: number | null;
  bestTestPct: number | null;
}

type CoachTab = "ai" | "library" | "tests" | "analytics";

/** One option list with the athlete's pick (▸) vs the correct answer (✓). */
function AnswerReview({
  item,
  selected,
  locale,
}: {
  item: AcademyItem;
  selected: string[];
  locale: Locale;
}) {
  const correct = new Set(item.correct_option_ids ?? []);
  const chosen = new Set(selected);
  if (item.options.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {item.options.map((o) => {
        const isCorrect = correct.has(o.id);
        const isChosen = chosen.has(o.id);
        return (
          <li
            key={o.id}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              isCorrect
                ? "bg-ok/15 font-medium text-ok"
                : isChosen
                  ? "bg-danger/15 text-danger"
                  : "text-muted",
            )}
          >
            {isChosen ? "▸ " : ""}
            {o.id.toUpperCase()}: {localizeText(o.text, locale)}
            {isCorrect ? " ✓" : ""}
          </li>
        );
      })}
    </ul>
  );
}

export function CoachAcademyClient({
  dict,
  locale,
  today,
  items,
  tests,
  groups,
  errorStats,
  athleteRows,
  responses,
  attempts,
}: {
  dict: Dictionary;
  locale: Locale;
  today: string;
  items: AcademyItem[];
  tests: AcademyTest[];
  groups: Group[];
  errorStats: GroupTopicErrorStat[];
  athleteRows: CoachAthleteAcademyRow[];
  responses: AcademyResponse[];
  attempts: AcademyTestAttempt[];
}) {
  const router = useRouter();
  const a = dict.academy;
  const c = a.coach;
  const [tab, setTab] = useState<CoachTab>("ai");
  const [libFilter, setLibFilter] = useState<"all" | "shown_month" | "reserve">("all");
  const [libTopic, setLibTopic] = useState<AcademyTopic | "all">("all");
  const [monthlyQCount, setMonthlyQCount] = useState<number>(10);
  const [buildingMonthly, setBuildingMonthly] = useState(false);

  const libStats = computeLibraryItemStats(items, responses, today);
  const existingTitles = items.map((it) => localizeText(it.title, "ru"));

  // AI prompt builder state
  const [aiMode, setAiMode] = useState<"daily_pack" | "monthly_test" | "visual_tactics">("daily_pack");
  const [aiTopic, setAiTopic] = useState<AcademyTopic | "all">("all");
  const [aiDifficulty, setAiDifficulty] = useState<AcademyLevel>("intermediate");
  const [aiCount, setAiCount] = useState<number>(5);
  const [rawJson, setRawJson] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [preview, setPreview] = useState<AiBatchPayload | null>(null);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openAthlete, setOpenAthlete] = useState<string | null>(null);

  // Lookups for the per-athlete answer drill-down.
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const testsById = new Map(tests.map((t) => [t.id, t]));
  const responsesByAthlete = new Map<string, AcademyResponse[]>();
  for (const r of responses) {
    const l = responsesByAthlete.get(r.athlete_id) ?? [];
    l.push(r);
    responsesByAthlete.set(r.athlete_id, l);
  }
  const attemptsByAthlete = new Map<string, AcademyTestAttempt[]>();
  for (const at of attempts) {
    const l = attemptsByAthlete.get(at.athlete_id) ?? [];
    l.push(at);
    attemptsByAthlete.set(at.athlete_id, l);
  }

  const generatedPrompt = buildAiPromptForCoach({
    mode: aiMode,
    topic: aiTopic,
    difficulty: aiDifficulty,
    count: aiCount,
    existingTitles,
  });

  async function handleBuildMonthlyTest() {
    if (buildingMonthly) return;
    setBuildingMonthly(true);
    const res = await createMonthlyReviewTest({
      questionCount: monthlyQCount,
      openImmediately: true,
    });
    setBuildingMonthly(false);
    if (!res.ok) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    toast.success(
      c.monthlyBuilderDone
        .replace("{n}", String(res.questionCount ?? 0))
        .replace("{m}", String(res.fromThisMonthCount ?? 0)),
    );
    router.refresh();
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      toast.success(c.promptCopied);
    } catch {
      toast.error(dict.common.error);
    }
  }

  function handleValidatePreview() {
    const res = parseAiAcademyPayload(rawJson);
    if (!res.ok) {
      setPreview(null);
      toast.error(res.error);
      return;
    }
    setPreview(res.data);
    toast.success(`✓ ${res.data.items.length}`);
  }

  async function handlePublishBatch() {
    if (importing) return;
    setImporting(true);
    const res = await importAiAcademyBatch({
      rawJson,
      scheduleStartDate: scheduleStart || null,
      targetGroupId: targetGroup || null,
    });
    setImporting(false);
    if (!res.ok) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    toast.success(`${dict.common.saved}: ${res.importedCount ?? 0}`);
    setRawJson("");
    setPreview(null);
    router.refresh();
  }

  async function handleTogglePub(it: AcademyItem) {
    setBusyId(it.id);
    const res = await toggleAcademyItemPublished({ id: it.id, published: !it.published });
    setBusyId(null);
    if (res.ok) router.refresh();
    else toast.error(res.error ?? dict.common.error);
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const res = await deleteAcademyItem(id);
    setBusyId(null);
    if (res.ok) router.refresh();
    else toast.error(res.error ?? dict.common.error);
  }

  async function handleLevelChange(athleteId: string, level: AcademyLevel) {
    setBusyId(athleteId);
    const res = await setAthleteAcademyLevel({ athleteId, level });
    setBusyId(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  function exportCsv() {
    const header = ["Athlete", "Code", "Level", "XP", "Completed", "AccuracyPct", "BestTestPct"];
    const lines = [
      header.join(","),
      ...athleteRows.map((r) =>
        [
          `"${r.name.replace(/"/g, '""')}"`,
          r.code,
          r.level,
          r.xp,
          r.completedCount,
          r.accuracyPct ?? "",
          r.bestTestPct ?? "",
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "academy-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">🎓 {c.title}</h1>
        <p className="text-sm text-muted">{c.subtitle}</p>
      </div>

      {/* Clear inventory KPI strip: total in DB, shown this month, in reserve, tests */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">{libStats.totalItems}</p>
            <p className="text-xs font-medium">{c.kpiTotalTitle}</p>
            <p className="text-[11px] text-muted">
              {c.kpiTotalSub
                .replace("{q}", String(libStats.quizItems))
                .replace("{f}", String(libStats.factItems))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-accent tabular-nums">
              {libStats.usedThisMonthCount}
            </p>
            <p className="text-xs font-medium">{c.kpiShownMonthTitle}</p>
            <p className="text-[11px] text-muted">{c.kpiShownMonthSub}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-ok tabular-nums">
              {libStats.unusedReserveCount}
            </p>
            <p className="text-xs font-medium">{c.kpiReserveTitle}</p>
            <p className="text-[11px] text-muted">{c.kpiReserveSub}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">{tests.length}</p>
            <p className="text-xs font-medium">{c.kpiTestsTitle}</p>
            <p className="text-[11px] text-muted">{c.kpiTestsSub}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5">
        {(
          [
            ["ai", c.aiTab],
            ["library", c.libraryTab.replace("{n}", String(items.length))],
            ["tests", `${c.testsTab} (${tests.length})`],
            ["analytics", c.analyticsTab],
          ] as [CoachTab, string][]
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

      {/* TAB 1: 1-CLICK AI GENERATOR & BATCH JSON IMPORTER */}
      {tab === "ai" && (
        <div className="space-y-4">
          <Card className="border-accent/30 bg-accent/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">📖 {c.guideHowTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted">
              <p>{c.guideStep1}</p>
              <p>{c.guideStep2}</p>
              <p>{c.guideStep3}</p>
              <p>{c.guideStep4}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{c.aiTitle}</CardTitle>
              <p className="text-xs text-muted">{c.aiStep1}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label>Формат</Label>
                  <Select
                    value={aiMode}
                    onChange={(e) =>
                      setAiMode(e.target.value as "daily_pack" | "monthly_test" | "visual_tactics")
                    }
                  >
                    <option value="daily_pack">{c.aiModeDaily}</option>
                    <option value="monthly_test">{c.aiModeMonthly}</option>
                    <option value="visual_tactics">{c.aiModeVisual}</option>
                  </Select>
                </div>
                <div>
                  <Label>{a.tabTopics}</Label>
                  <Select
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value as AcademyTopic | "all")}
                  >
                    <option value="all">Все 10 тем</option>
                    {ACADEMY_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {a.topics[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>{a.levelLabel}</Label>
                  <Select
                    value={aiDifficulty}
                    onChange={(e) => setAiDifficulty(e.target.value as AcademyLevel)}
                  >
                    {ACADEMY_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {a.levels[l]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Количество</Label>
                  <Select value={String(aiCount)} onChange={(e) => setAiCount(Number(e.target.value))}>
                    {[3, 5, 7, 10, 15].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void copyPrompt()}>
                  {c.copyPromptBtn}
                </Button>
                <span className="text-xs text-muted">
                  ✓ {c.promptAvoidInfo.replace("{n}", String(items.length))}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{c.aiStep2}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={7}
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                placeholder={c.pasteJsonPh}
                className="font-mono text-xs"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>{c.scheduleStartLabel}</Label>
                  <Input
                    type="date"
                    value={scheduleStart}
                    onChange={(e) => setScheduleStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label>{c.targetGroupLabel}</Label>
                  <Select value={targetGroup} onChange={(e) => setTargetGroup(e.target.value)}>
                    <option value="">—</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!rawJson.trim()}
                  onClick={handleValidatePreview}
                >
                  {c.previewBtn}
                </Button>
                <Button
                  type="button"
                  disabled={!rawJson.trim() || importing}
                  onClick={() => void handlePublishBatch()}
                >
                  {c.importPublishBtn.replace("{n}", String(preview?.items.length ?? "…"))}
                </Button>
              </div>

              {preview && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">Превью языка:</span>
                    {(["ru", "en", "ro"] as Locale[]).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setPreviewLang(l)}
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-bold uppercase",
                          previewLang === l ? "bg-accent text-accent-foreground" : "bg-foreground/10",
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {preview.items.map((it) => (
                    <Card key={it.code} className="border-accent/30">
                      <CardContent className="space-y-2 pt-4 text-xs">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="accent">{it.code}</Badge>
                          <Badge tone="neutral">{a.topics[it.topic]}</Badge>
                          <Badge tone="neutral">{a.levels[it.difficulty]}</Badge>
                        </div>
                        <p className="text-sm font-semibold">{it.title[previewLang]}</p>
                        <p className="text-muted">{it.body[previewLang]}</p>
                        {it.court_diagram && <TacticalCourtDiagram diagram={it.court_diagram} />}
                        <ul className="space-y-1">
                          {it.options.map((o) => (
                            <li
                              key={o.id}
                              className={cn(
                                "rounded px-2 py-1",
                                it.correct_option_ids.includes(o.id)
                                  ? "bg-ok/15 font-semibold text-ok"
                                  : "bg-foreground/5",
                              )}
                            >
                              {o.id.toUpperCase()}: {o.text[previewLang]}
                            </li>
                          ))}
                        </ul>
                        <p className="text-muted">💡 {it.explanation[previewLang]}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: CONTENT LIBRARY */}
      {tab === "library" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", c.filterAll.replace("{n}", String(items.length))],
                  [
                    "shown_month",
                    c.filterShownMonth.replace("{n}", String(libStats.usedThisMonthCount)),
                  ],
                  [
                    "reserve",
                    c.filterReserve.replace("{n}", String(libStats.unusedReserveCount)),
                  ],
                ] as ["all" | "shown_month" | "reserve", string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLibFilter(k)}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                    libFilter === k
                      ? "bg-accent text-accent-foreground"
                      : "bg-foreground/5 text-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Select
              className="w-48"
              value={libTopic}
              onChange={(e) => setLibTopic(e.target.value as AcademyTopic | "all")}
            >
              <option value="all">{a.tabTopics}: {items.length}</option>
              {ACADEMY_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {a.topics[t]}
                </option>
              ))}
            </Select>
          </div>

          {items
            .filter((it) => {
              const u = libStats.byItemId[it.id];
              if (libFilter === "shown_month" && !u?.usedThisMonth) return false;
              if (libFilter === "reserve" && u?.everUsed) return false;
              if (libTopic !== "all" && it.topic !== libTopic) return false;
              return true;
            })
            .map((it) => {
              const u = libStats.byItemId[it.id];
              return (
                <Card key={it.id}>
                  <CardContent className="space-y-2 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={
                            u?.usedThisMonth ? "accent" : u?.everUsed ? "neutral" : "ok"
                          }
                        >
                          {u?.usedThisMonth
                            ? c.badgeShownMonth
                            : u?.everUsed
                              ? c.badgeShownPast
                              : c.badgeNeverShown}
                        </Badge>
                        <Badge tone="neutral">{a.topics[it.topic]}</Badge>
                        <Badge tone="neutral">{a.levels[it.difficulty]}</Badge>
                        <Badge tone="neutral">{a.itemTypes[it.item_type]}</Badge>
                        {it.scheduled_date && <Badge tone="warn">📅 {it.scheduled_date}</Badge>}
                        {!it.published && <Badge tone="neutral">Draft</Badge>}
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === it.id}
                          onClick={() => void handleTogglePub(it)}
                        >
                          {c.togglePubBtn}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === it.id}
                          onClick={() => void handleDelete(it.id)}
                        >
                          {c.deleteBtn}
                        </Button>
                      </div>
                    </div>
                    <p className="font-semibold text-sm">{localizeText(it.title, locale)}</p>
                    <p className="text-xs text-muted">{localizeText(it.body, locale)}</p>
                    {it.court_diagram && <TacticalCourtDiagram diagram={it.court_diagram} />}
                    {it.options.length > 0 && (
                      <AnswerReview item={it} selected={[]} locale={locale} />
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted">
                      <span>
                        👥{" "}
                        {c.answeredStat
                          .replace("{n}", String(u?.answeredByCount ?? 0))
                          .replace("{p}", String(u?.accuracyPct ?? "—"))}
                      </span>
                      {u?.lastSeenDate && (
                        <span>
                          🕒 {c.lastSeenStat.replace("{d}", u.lastSeenDate)}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* TAB 3: MONTHLY TESTS */}
      {tab === "tests" && (
        <div className="space-y-3">
          <Card className="border-accent/40 bg-accent/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">🏁 {c.monthlyBuilderTitle}</CardTitle>
              <p className="text-xs text-muted">
                {c.monthlyBuilderDesc
                  .replace(
                    "{m}",
                    String(
                      items.filter(
                        (i) => i.item_type !== "fact" && libStats.byItemId[i.id]?.usedThisMonth,
                      ).length,
                    ),
                  )
                  .replace("{q}", String(libStats.quizItems))}
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Select
                className="w-32"
                value={String(monthlyQCount)}
                onChange={(e) => setMonthlyQCount(Number(e.target.value))}
              >
                {[5, 8, 10, 12, 15].map((n) => (
                  <option key={n} value={n}>
                    {a.questionsCount.replace("{n}", String(n))}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={buildingMonthly}
                onClick={() => void handleBuildMonthlyTest()}
              >
                {c.monthlyBuilderBtn.replace(
                  "{n}",
                  String(Math.min(monthlyQCount, libStats.quizItems)),
                )}
              </Button>
            </CardContent>
          </Card>

          {tests.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{localizeText(t.title, locale)}</CardTitle>
                  <div className="flex gap-1.5">
                    <Badge tone="accent">
                      {a.questionsCount.replace("{n}", String(t.question_count))}
                    </Badge>
                    <Badge tone="neutral">
                      {t.available_from} → {t.available_until}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted">{localizeText(t.description, locale)}</p>
                <details className="rounded-lg bg-foreground/[0.03] p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    {a.questionsCount.replace("{n}", String(t.question_ids.length))}
                  </summary>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted">
                    {t.question_ids.map((qid) => {
                      const q = itemsById.get(qid);
                      return (
                        <li key={qid}>
                          <span className="text-foreground">
                            {q ? localizeText(q.title, locale) : qid}
                          </span>
                          {q && (
                            <span className="ml-1.5 text-[11px] text-muted">
                              ({a.topics[q.topic]})
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* TAB 4: GROUP ERROR ANALYTICS & ATHLETE LEVELS */}
      {tab === "analytics" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">📊 {c.errorHotspotsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {errorStats.map((st) => (
                <div
                  key={st.topic}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs"
                >
                  <span className="font-medium">{a.topics[st.topic]}</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      st.errorRatePct >= 40
                        ? "text-danger"
                        : st.errorRatePct >= 20
                          ? "text-warn"
                          : "text-ok",
                    )}
                  >
                    {c.errorRateLabel
                      .replace("{e}", String(st.errorRatePct))
                      .replace("{w}", String(st.wrongAnswers))
                      .replace("{t}", String(st.totalAnswers))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{c.athleteLevelsTitle}</CardTitle>
              <Button size="sm" variant="secondary" onClick={exportCsv}>
                ⬇️ {c.exportCsvBtn}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {athleteRows.map((r) => {
                const open = openAthlete === r.id;
                const myResps = responsesByAthlete.get(r.id) ?? [];
                const myAttempts = (attemptsByAthlete.get(r.id) ?? []).filter(
                  (at) => at.status !== "in_progress",
                );
                return (
                  <div key={r.id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {r.name}{" "}
                          <span className="text-xs font-normal text-muted">({r.code})</span>
                        </p>
                        <p className="text-xs text-muted">
                          XP: <b className="text-foreground">{r.xp}</b> · {a.completedLabel}:{" "}
                          <b className="text-foreground">{r.completedCount}</b> · {a.accuracyLabel}:{" "}
                          <b className="text-foreground">
                            {r.accuracyPct !== null ? `${r.accuracyPct}%` : "—"}
                          </b>
                          {r.bestTestPct !== null ? ` · Test: ${r.bestTestPct}%` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setOpenAthlete(open ? null : r.id)}
                        >
                          {open ? c.hideAnswersBtn : c.viewAnswersBtn}
                        </Button>
                        <Select
                          className="w-40"
                          disabled={busyId === r.id}
                          value={r.level}
                          onChange={(e) =>
                            void handleLevelChange(r.id, e.target.value as AcademyLevel)
                          }
                        >
                          {ACADEMY_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {a.levels[l]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                        <p className="text-[11px] font-semibold text-muted">
                          {c.lastAnswersTitle} · ▸ {c.chosenTag} · ✓ {c.correctTag}
                        </p>
                        {myResps.length === 0 && (
                          <p className="text-xs text-muted">{c.noAnswersYet}</p>
                        )}
                        {myResps.slice(0, 12).map((resp) => {
                          const it = itemsById.get(resp.item_id);
                          if (!it) return null;
                          return (
                            <div key={resp.id} className="rounded-lg bg-foreground/[0.03] p-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-medium">
                                  {resp.is_correct ? "✅" : "❌"}{" "}
                                  {localizeText(it.title, locale)}
                                </p>
                                <span className="shrink-0 text-[10px] text-muted">
                                  {resp.assigned_date}
                                </span>
                              </div>
                              <AnswerReview
                                item={it}
                                selected={resp.selected_option_ids}
                                locale={locale}
                              />
                            </div>
                          );
                        })}

                        {myAttempts.length > 0 && (
                          <>
                            <p className="pt-1 text-[11px] font-semibold text-muted">
                              {c.attemptsTitle}
                            </p>
                            {myAttempts.map((at) => {
                              const t = testsById.get(at.test_id);
                              return (
                                <details
                                  key={at.id}
                                  className="rounded-lg bg-foreground/[0.03] p-2"
                                >
                                  <summary className="cursor-pointer text-xs font-medium">
                                    {t ? localizeText(t.title, locale) : at.test_id} ·{" "}
                                    {c.attemptN.replace("{n}", String(at.attempt_number))} ·{" "}
                                    <b>
                                      {at.score_pct ?? "—"}% ({at.correct_count}/{at.total_count})
                                    </b>
                                  </summary>
                                  <div className="mt-1.5 space-y-1.5">
                                    {at.question_order.map((qid, qi) => {
                                      const it = itemsById.get(qid);
                                      if (!it) return null;
                                      const sel = at.final_answers[qid] ?? [];
                                      const correct = new Set(it.correct_option_ids ?? []);
                                      const ok =
                                        sel.length === correct.size &&
                                        sel.every((s) => correct.has(s));
                                      return (
                                        <div key={qid}>
                                          <p className="text-[11px] font-medium">
                                            {ok ? "✅" : "❌"} {qi + 1}.{" "}
                                            {localizeText(it.title, locale)}
                                          </p>
                                          <AnswerReview
                                            item={it}
                                            selected={sel}
                                            locale={locale}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
