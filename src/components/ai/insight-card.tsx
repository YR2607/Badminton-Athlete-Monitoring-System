"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { analyzeAthlete, analyzeGroup, sendInsightFeedback, type InsightRow } from "@/app/actions/ai-insights";
import type { AIInsight } from "@/lib/ai/schema";
import type { Dictionary } from "@/i18n";

const SEV_TONE: Record<string, "neutral" | "warn" | "danger"> = {
  info: "neutral",
  attention: "warn",
  important: "danger",
};

/** AI interpretation card — visually distinct (dashed border, AI badge). */
export function AIInsightCard({
  target,
  initial,
  d,
}: {
  target: { kind: "athlete" | "group"; id: string };
  initial: InsightRow | null;
  d: Dictionary["ai"];
}) {
  const [row, setRow] = useState(initial);
  const [pending, setPending] = useState(false);
  const [rated, setRated] = useState<1 | -1 | 0>(0);
  const insight = row && !row.insufficient ? (row.insight as AIInsight) : null;

  async function refresh() {
    setPending(true);
    const res = target.kind === "group" ? await analyzeGroup(target.id) : await analyzeAthlete(target.id);
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
          <span className="flex-1">{insight ? insight.title : d.title}</span>
          {insight && <Badge tone={SEV_TONE[insight.severity] ?? "neutral"}>{d[`sev_${insight.severity}` as keyof typeof d]}</Badge>}
          <Button size="sm" variant="secondary" disabled={pending} onClick={refresh}>
            {pending ? "…" : row ? d.refresh : d.generate}
          </Button>
        </CardTitle>
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
                <p className="font-medium">{insight.observation}</p>
                <p className="mt-0.5 text-muted">{insight.interpretation}</p>
              </div>
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
                        {r.action}
                        <span className="text-muted"> — {r.rationale}</span>
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
