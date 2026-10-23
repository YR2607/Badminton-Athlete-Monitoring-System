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
const SEV_RANK: Record<string, number> = { priority: 0, review_load: 1, attention: 2, normal: 3 };

/** Render alert evidence as readable "Label: value" lines instead of raw JSON. */
function evidenceLines(dict: Dictionary, ev: Record<string, unknown>): string[] {
  const L = dict.alerts.ev;
  const m = dict.morning;
  const painStatusLabel = (s: unknown) =>
    (
      ({
        none: m.painNone,
        muscle_soreness: m.painMuscle,
        joint_tendon: m.painJoint,
        acute_instability: m.painAcute,
        other: m.painOther,
      }) as Record<string, string>
    )[String(s)] ?? String(s);
  const triggerLabel = (t: unknown) =>
    (
      ({
        walking: m.triggerWalking,
        jumping: m.triggerJumping,
        lunges: m.triggerLunges,
        rest: m.triggerRest,
      }) as Record<string, string>
    )[String(t)] ?? String(t);
  const dayScores = (arr: unknown, key: string) =>
    Array.isArray(arr)
      ? arr.map((x) => `${(x as Record<string, unknown>).date}: ${(x as Record<string, unknown>)[key]}`).join(" · ")
      : null;

  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    lines.push(`${label}: ${value}`);
  };

  push(L.painStatus, ev.pain_status ? painStatusLabel(ev.pain_status) : null);
  push(L.painLocation, ev.pain_location);
  push(L.painSeverity, ev.pain_severity != null ? `${ev.pain_severity}/10` : null);
  if (ev.swelling !== undefined) push(L.swelling, ev.swelling ? dict.common.yes : dict.common.no);
  if (ev.movement_limitation !== undefined)
    push(L.limitation, ev.movement_limitation ? dict.common.yes : dict.common.no);
  push(
    L.triggers,
    Array.isArray(ev.triggers) && ev.triggers.length > 0
      ? (ev.triggers as unknown[]).map(triggerLabel).join(", ")
      : null,
  );
  push(L.source, ev.source === "morning" ? L.sourceMorning : ev.source ? L.sourcePost : null);
  push(L.symptoms, ev.symptoms);
  push(L.todayScore, ev.today_score);
  push(L.baselineAvg, ev.baseline_avg != null ? Math.round(Number(ev.baseline_avg)) : null);
  push(L.delta, ev.delta);
  push(L.daysBelow, ev.days_below_baseline);
  push(L.days, ev.days);
  push(L.scores, dayScores(ev.recent_scores, "score"));
  push(L.fatigueScores, dayScores(ev.fatigue_scores, "fatigue"));
  push(L.date, ev.date ?? ev.checkin_date);
  if (typeof ev.local_minutes === "number") {
    const hh = String(Math.floor(ev.local_minutes / 60)).padStart(2, "0");
    const mm = String(ev.local_minutes % 60).padStart(2, "0");
    push(L.hour, `${hh}:${mm}`);
  }
  return lines;
}

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
  const [sort, setSort] = useState<string>("newest");

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
    return [...out].sort((a, b) => {
      switch (sort) {
        case "severity":
          return (
            (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
            b.triggered_at.localeCompare(a.triggered_at)
          );
        case "athlete":
          return (nameOf.get(a.athlete_id) ?? "").localeCompare(nameOf.get(b.athlete_id) ?? "");
        case "oldest":
          return a.triggered_at.localeCompare(b.triggered_at);
        default:
          return b.triggered_at.localeCompare(a.triggered_at);
      }
    });
  }, [alerts, status, severity, athleteId, q, sort, nameOf]);

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
          <Select className="w-36" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">{d.sortNewest}</option>
            <option value="oldest">{d.sortOldest}</option>
            <option value="severity">{d.sortSeverity}</option>
            {athletes && <option value="athlete">{dict.common.athlete}</option>}
          </Select>
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
                    {dict.rules.items[a.rule_code as keyof typeof dict.rules.items]?.name ?? a.rule_code}
                    {" · "}
                    {a.triggered_at.slice(0, 16).replace("T", " ")}
                  </span>
                  {nameOf.has(a.athlete_id) && (
                    <span className="text-xs font-medium">{nameOf.get(a.athlete_id)}</span>
                  )}
                  <Badge tone={a.status === "open" ? "warn" : "neutral"}>
                    {statusLabel(a.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{a.recommendation}</p>
                {Object.keys(a.evidence).length > 0 && (
                  <ul className="mt-2 space-y-0.5 rounded-lg bg-foreground/5 px-3 py-2 text-xs text-muted">
                    {evidenceLines(dict, a.evidence).map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
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
