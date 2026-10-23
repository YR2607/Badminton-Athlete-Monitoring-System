"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { reviewAlert } from "@/app/actions/coach";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import type { Alert, AlertStatus } from "@/lib/types";

const sevTone: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  priority: "danger",
  review_load: "warn",
  attention: "accent",
  normal: "neutral",
};

export function AlertList({ alerts, dict }: { alerts: Alert[]; dict: Dictionary }) {
  const d = dict.alerts;
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? alerts : alerts.filter((a) => a.status === "open");

  async function act(id: string, status: AlertStatus) {
    setBusy(id);
    const res = await reviewAlert({
      alert_id: id,
      status: status as "acknowledged" | "resolved" | "dismissed",
      resolution_note: note[id]?.trim() || undefined,
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
        <div className="flex items-center justify-between">
          <CardTitle>{d.title}</CardTitle>
          <button className="text-xs text-accent" onClick={() => setShowAll(!showAll)}>
            {showAll ? d.open : d.all}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-sm text-muted">{dict.common.noData}</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={sevTone[a.severity]}>
                    {d.severity[a.severity as keyof typeof d.severity]}
                  </Badge>
                  <span className="text-xs text-muted">
                    {a.rule_code} · {a.triggered_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <Badge tone={a.status === "open" ? "warn" : "neutral"}>
                    {a.status === "open"
                      ? d.statusOpen
                      : a.status === "acknowledged"
                        ? d.statusAcknowledged
                        : a.status === "resolved"
                          ? d.statusResolved
                          : d.statusDismissed}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{a.recommendation}</p>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-foreground/5 p-2 text-xs text-muted">
                  {JSON.stringify(a.evidence, null, 1)}
                </pre>
                {a.resolution_note && (
                  <p className="mt-1 text-xs text-muted">
                    {d.resolutionNote}: {a.resolution_note}
                  </p>
                )}
                {a.status === "open" && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      placeholder={d.resolutionNote}
                      value={note[a.id] ?? ""}
                      onChange={(e) => setNote({ ...note, [a.id]: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => act(a.id, "acknowledged")}>
                        {d.acknowledge}
                      </Button>
                      <Button size="sm" disabled={busy === a.id} onClick={() => act(a.id, "resolved")}>
                        {d.resolve}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => act(a.id, "dismissed")}>
                        {d.dismiss}
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
