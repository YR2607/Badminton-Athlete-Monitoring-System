"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { reviewAlert } from "@/app/actions/coach";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Alert, AlertStatus } from "@/lib/types";

const sevTone: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  priority: "danger",
  review_load: "warn",
  attention: "accent",
  normal: "neutral",
};

const SEVERITIES = ["priority", "review_load", "attention", "normal"] as const;
const STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;

export function AlertList({
  alerts,
  dict,
  athletes,
}: {
  alerts: Alert[];
  dict: Dictionary;
  athletes?: { id: string; name: string }[];
}) {
  const d = dict.alerts;
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("open");
  const [severity, setSeverity] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [q, setQ] = useState("");

  const nameOf = useMemo(
    () => new Map((athletes ?? []).map((a) => [a.id, a.name])),
    [athletes],
  );

  const visible = useMemo(() => {
    let out = alerts;
    if (status) out = out.filter((a) => a.status === status);
    if (severity) out = out.filter((a) => a.severity === severity);
    if (athleteId) out = out.filter((a) => a.athlete_id === athleteId);
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(
        (a) =>
          a.rule_code.toLowerCase().includes(needle) ||
          a.recommendation.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [alerts, status, severity, athleteId, q]);

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

  const statusLabel = (s: string) =>
    s === "open"
      ? d.statusOpen
      : s === "acknowledged"
        ? d.statusAcknowledged
        : s === "resolved"
          ? d.statusResolved
          : d.statusDismissed;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{d.allStatuses}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">{d.allSeverities}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {d.severity[s]}
              </option>
            ))}
          </Select>
          {athletes && (
            <Select className="w-40" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">{dict.analytics.scopeAll}</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            className="w-40 flex-1 sm:flex-none"
            placeholder={dict.common.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
                  {nameOf.has(a.athlete_id) && (
                    <span className="text-xs font-medium">{nameOf.get(a.athlete_id)}</span>
                  )}
                  <Badge tone={a.status === "open" ? "warn" : "neutral"}>
                    {statusLabel(a.status)}
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
