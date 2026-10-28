"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  deleteAcademyItem,
  importAiAcademyBatch,
  setAthleteAcademyLevel,
  toggleAcademyItemPublished,
} from "@/app/actions/academy";
import {
  ACADEMY_LEVELS,
  ACADEMY_TOPICS,
  buildAiPromptForCoach,
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
  AcademyTest,
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

export function CoachAcademyClient({
  dict,
  locale,
  items,
  tests,
  groups,
  errorStats,
  athleteRows,
}: {
  dict: Dictionary;
  locale: Locale;
  items: AcademyItem[];
  tests: AcademyTest[];
  groups: Group[];
  errorStats: GroupTopicErrorStat[];
  athleteRows: CoachAthleteAcademyRow[];
}) {
  const router = useRouter();
  const a = dict.academy;
  const c = a.coach;
  const [tab, setTab] = useState<CoachTab>("ai");

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

  const generatedPrompt = buildAiPromptForCoach({
    mode: aiMode,
    topic: aiTopic,
    difficulty: aiDifficulty,
    count: aiCount,
  });

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
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="space-y-2 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={it.published ? "ok" : "neutral"}>
                      {it.published ? "Published" : "Draft"}
                    </Badge>
                    <Badge tone="accent">{a.topics[it.topic]}</Badge>
                    <Badge tone="neutral">{a.levels[it.difficulty]}</Badge>
                    <Badge tone="neutral">{a.itemTypes[it.item_type]}</Badge>
                    {it.scheduled_date && <Badge tone="warn">📅 {it.scheduled_date}</Badge>}
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* TAB 3: MONTHLY TESTS */}
      {tab === "tests" && (
        <div className="space-y-3">
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
              <CardContent>
                <p className="text-xs text-muted">{localizeText(t.description, locale)}</p>
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
              {athleteRows.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm"
                >
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
                  <Select
                    className="w-40"
                    disabled={busyId === r.id}
                    value={r.level}
                    onChange={(e) => void handleLevelChange(r.id, e.target.value as AcademyLevel)}
                  >
                    {ACADEMY_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {a.levels[l]}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
