"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { reviewRecommendation } from "@/app/actions/coach";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import type { Recommendation } from "@/lib/types";

const sevTone: Record<string, "danger" | "warn" | "accent" | "neutral" | "ok"> = {
  medical: "danger",
  rest: "warn",
  reduce: "warn",
  talk: "accent",
  info: "ok",
};

const sevLabel = (d: Dictionary, s: string) =>
  (({
    medical: d.recs.sevMedical,
    rest: d.recs.sevRest,
    reduce: d.recs.sevReduce,
    talk: d.recs.sevTalk,
    info: d.recs.sevInfo,
  }) as Record<string, string>)[s] ?? s;

const decLabel = (d: Dictionary, s: string) =>
  (({
    pending: d.recs.decPending,
    accepted: d.recs.decAccepted,
    modified: d.recs.decModified,
    rejected: d.recs.decRejected,
  }) as Record<string, string>)[s] ?? s;

const recText = (d: Dictionary, key: string) =>
  (d.recs.texts as Record<string, string>)[key] ?? key;

export function RecList({
  recs,
  dict,
}: {
  recs: Recommendation[];
  dict: Dictionary;
}) {
  const d = dict.recs;
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, decision: "accepted" | "modified" | "rejected") {
    setBusy(id);
    const res = await reviewRecommendation({
      recommendation_id: id,
      decision,
      coach_comment: note[id]?.trim() || undefined,
    });
    setBusy(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {recs.length === 0 ? (
          <p className="text-sm text-muted">{d.empty}</p>
        ) : (
          <ul className="space-y-3">
            {recs.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={sevTone[r.severity]}>{sevLabel(dict, r.severity)}</Badge>
                  <span className="text-xs text-muted">{r.rec_date}</span>
                  <Badge tone={r.decision === "pending" ? "warn" : "neutral"}>
                    {decLabel(dict, r.decision)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{recText(dict, r.rule_key)}</p>
                <p className="mt-1 text-xs text-muted">
                  {[
                    r.inputs.z != null && `z: ${r.inputs.z}`,
                    r.inputs.acwr != null && `ACWR: ${r.inputs.acwr}`,
                    Array.isArray(r.inputs.physical_dip) &&
                      (r.inputs.physical_dip as string[]).length > 0 &&
                      `${d.dipPhys}: ${(r.inputs.physical_dip as string[]).join(", ")}`,
                    Array.isArray(r.inputs.psych_dip) &&
                      (r.inputs.psych_dip as string[]).length > 0 &&
                      `${d.dipPsych}: ${(r.inputs.psych_dip as string[]).join(", ")}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {r.coach_comment && (
                  <p className="mt-1 text-xs text-muted">
                    {d.comment}: {r.coach_comment}
                  </p>
                )}
                {r.decision === "pending" && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      placeholder={d.commentPh}
                      value={note[r.id] ?? ""}
                      onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "accepted")}>
                        {d.accept}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === r.id}
                        onClick={() => act(r.id, "modified")}
                      >
                        {d.modify}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === r.id}
                        onClick={() => act(r.id, "rejected")}
                      >
                        {d.reject}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
