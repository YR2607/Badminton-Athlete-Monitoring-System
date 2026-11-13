"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  analyzeAthlete,
  analyzeGroup,
  sendInsightFeedback,
  type InsightRow,
} from "@/app/actions/ai-insights";
import type { AIInsight } from "@/lib/ai/schema";
import type { Dictionary } from "@/i18n";

const SEV_TONE: Record<string, "neutral" | "warn" | "danger"> = {
  info: "neutral",
  attention: "warn",
  important: "danger",
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const presetRange = (days: number) => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
};

/** AI interpretation card — visually distinct (dashed border, AI badge). */
export function AIInsightCard({
  target,
  initial,
  d,
  names,
}: {
  target: { kind: "athlete" | "group"; id: string };
  initial: InsightRow | null;
  d: Dictionary["ai"];
  /** athlete_code → display name; model sees codes only, UI resolves them. */
  names?: Record<string, string>;
}) {
  const [row, setRow] = useState(initial);
  const [pending, setPending] = useState(false);
  const [rated, setRated] = useState<1 | -1 | 0>(0);
  const [range, setRange] = useState<{ from: string; to: string }>(() => presetRange(14));
  const activePreset = [7, 14, 30].find((n) => {
    const p = presetRange(n);
    return p.from === range.from && p.to === range.to;
  });
  const insight = row && !row.insufficient ? (row.insight as AIInsight) : null;
  const codes = Object.keys(names ?? {});
  const codeRe = codes.length ? new RegExp(`\\b(${codes.join("|")})\\b`, "g") : null;
  const nameify = (s: string) => (codeRe ? s.replace(codeRe, (m) => names![m] ?? m) : s);
  const areaLabel = (a: string) =>
    (d[`area_${a}` as keyof typeof d] as string | undefined) ?? a;
  const sections = insight?.sections ?? [];
  const watch = insight?.watch ?? [];
  const positives = insight?.positives ?? [];
  const questions = insight?.questions ?? [];

  async function refresh() {
    setPending(true);
    const res =
      target.kind === "group"
        ? await analyzeGroup(target.id, range)
        : await analyzeAthlete(target.id, range);
    setPending(false);
    if (res.ok) setRow(res.data);
    else toast.error(res.error);
  }

  async function rate(r: 1 | -1) {
    if (!row) return;
    setRated(r);
    const res = await sendInsightFeedback(row.id, r);
    if (!res.ok) toast.error(d.error);
  }

  return (
    <Card className="border-dashed border-accent/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge tone="accent">{d.badge}</Badge>
          <span className="flex-1">{insight ? nameify(insight.title) : d.title}</span>
          {insight && <Badge tone={SEV_TONE[insight.severity] ?? "neutral"}>{d[`sev_${insight.severity}` as keyof typeof d]}</Badge>}
          <Button size="sm" variant="secondary" disabled={pending} onClick={refresh}>
            {pending ? "…" : row ? d.refresh : d.generate}
          </Button>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {[7, 14, 30].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={activePreset === n ? "default" : "secondary"}
              onClick={() => setRange(presetRange(n))}
            >
              {n} {d.days}
            </Button>
          ))}
          <div className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto">
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="h-9 min-h-9 w-full min-w-0 flex-1 px-2 py-1 text-xs sm:w-40 sm:flex-none"
            />
            <span className="shrink-0 text-xs text-muted">–</span>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              max={iso(new Date())}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="h-9 min-h-9 w-full min-w-0 flex-1 px-2 py-1 text-xs sm:w-40 sm:flex-none"
            />
          </div>
        </div>
        <p className="text-xs text-muted">{d.disclaimer}</p>
      </CardHeader>
      {row && (
        <CardContent className="space-y-3 text-sm">
          {row.insufficient ? (
            <p className="text-muted">
              {d.insufficient}
              {row.reason ? ` — ${row.reason}` : ""}
            </p>
          ) : insight ? (
            <>
              <div>
                <p className="font-medium">{nameify(insight.observation)}</p>
                <p className="mt-0.5 text-muted">{nameify(insight.interpretation)}</p>
              </div>
              {sections.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">{d.sections}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {sections.map((s, i) => (
                      <li key={i}>
                        <span className="font-medium">{areaLabel(s.area)}:</span>{" "}
                        {nameify(s.finding)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {watch.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">{d.watch}</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {watch.map((w, i) => (
                      <li key={i}>
                        <span className="font-medium">{nameify(w.subject)}</span>
                        {w.reason ? (
                          <span className="text-muted"> — {nameify(w.reason)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {positives.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">{d.positives}</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {positives.map((p, i) => (
                      <li key={i}>{nameify(p)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {questions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">{d.questions}</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {questions.map((q, i) => (
                      <li key={i}>{nameify(q)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {insight.evidence.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted">
                    {d.evidence} ({insight.evidence.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {insight.evidence.map((e, i) => (
                      <li key={i}>
                        {e.metric}: <b className="text-foreground">{String(e.value)}</b> ({e.period})
                        {e.comparison ? ` · ${e.comparison}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {insight.recommendations.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">{d.recs}</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {insight.recommendations.map((r, i) => (
                      <li key={i}>
                        {nameify(r.action)}
                        <span className="text-muted"> — {nameify(r.rationale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>
                  {d.confidence}: <b>{d[`conf_${insight.confidence}` as keyof typeof d]}</b>
                </span>
                {insight.limitations.length > 0 && (
                  <span title={insight.limitations.join("\n")}>
                    · {d.limits}: {insight.limitations.length}
                  </span>
                )}
                <span>· {d.period}: {insight.period.from} — {insight.period.to}</span>
                <span className="ml-auto">
                  {d.updated} {row.generated_at.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => rate(1)}
                  title={d.useful}
                  className={`rounded px-1.5 py-0.5 ${rated === 1 ? "bg-ok/15" : "hover:bg-foreground/5"}`}
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() => rate(-1)}
                  title={d.inaccurate}
                  className={`rounded px-1.5 py-0.5 ${rated === -1 ? "bg-danger/15" : "hover:bg-foreground/5"}`}
                >
                  👎
                </button>
              </div>
            </>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
