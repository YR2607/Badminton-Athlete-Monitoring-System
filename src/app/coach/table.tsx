"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { CoachAthleteRow } from "@/lib/coach-data";
import { STATUS_ORDER, type AthleteStatus } from "@/lib/athlete-status";
import { TriangleAlert, RefreshCw, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";
import type { Group } from "@/lib/types";

type SortKey = "priority" | "name" | "scoreDesc" | "scoreAsc";

const ALL_STATUSES: AthleteStatus[] = ["needs_check", "declining", "no_today", "insufficient", "ok"];

function readinessTone(v: number | null): string {
  if (v === null) return "text-muted";
  if (v >= 70) return "text-ok";
  if (v >= 45) return "text-warn";
  return "text-danger";
}

function statusTone(s: AthleteStatus): "danger" | "warn" | "neutral" | "ok" | "accent" {
  switch (s) {
    case "needs_check":
      return "danger";
    case "declining":
      return "warn";
    case "ok":
      return "ok";
    case "no_today":
      return "accent";
    default:
      return "neutral";
  }
}

export function CoachTable({
  rows,
  groups,
  dict,
}: {
  rows: CoachAthleteRow[];
  groups: Group[];
  dict: Dictionary;
}) {
  const d = dict.coach;
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [painOnly, setPainOnly] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("priority");

  const filtered = useMemo(() => {
    let out = rows;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(
        (r) =>
          r.profile?.display_name.toLowerCase().includes(needle) ||
          r.athlete.athlete_code.toLowerCase().includes(needle),
      );
    }
    if (groupId) out = out.filter((r) => r.group?.id === groupId);
    if (status) out = out.filter((r) => r.status === status);
    if (painOnly) out = out.filter((r) => r.hasPain);
    if (missedOnly) out = out.filter((r) => !r.todayCheckin);
    return [...out].sort((a, b) => {
      switch (sort) {
        case "priority":
          return (
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            (a.todayScore ?? 101) - (b.todayScore ?? 101)
          );
        case "scoreDesc":
          return (b.todayScore ?? -1) - (a.todayScore ?? -1);
        case "scoreAsc":
          return (
            (a.todayScore ?? Infinity) - (b.todayScore ?? Infinity)
          );
        default:
          return (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? "");
      }
    });
  }, [rows, q, groupId, status, painOnly, missedOnly, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-40 flex-1 sm:flex-none"
          placeholder={dict.common.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-36" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{d.filterByGroup}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{d.statusAll}</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {d.status[s]}
            </option>
          ))}
        </Select>
        <label className="flex min-h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={painOnly} onChange={(e) => setPainOnly(e.target.checked)} />
          {d.hasPain}
        </label>
        <label className="flex min-h-9 items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={missedOnly}
            onChange={(e) => setMissedOnly(e.target.checked)}
          />
          {d.missedCheckins}
        </label>
        <Select className="w-36" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="priority">{d.sortPriority}</option>
          <option value="name">{d.tableAthlete}</option>
          <option value="scoreDesc">{d.sortScoreDesc}</option>
          <option value="scoreAsc">{d.sortScoreAsc}</option>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => {
          const name = r.profile?.display_name ?? r.athlete.athlete_code;
          const spark = r.series.slice(-7).map((p) => p.score);
          return (
            <Link
              key={r.athlete.id}
              href={`/coach/athletes/${r.athlete.id}`}
              className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40 active:bg-foreground/[0.03]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone(r.status)}>{d.status[r.status]}</Badge>
                {r.openAlerts.some((a) => a.severity === "priority") && (
                  <Badge tone="danger" title={dict.alerts.severity.priority}>
                    <TriangleAlert size={11} strokeWidth={2.5} />
                  </Badge>
                )}
                {r.openAlerts.some((a) => a.severity === "review_load") && (
                  <Badge tone="warn" title={dict.alerts.severity.review_load}>
                    <RefreshCw size={11} strokeWidth={2.5} />
                  </Badge>
                )}
                {r.openAlerts.some((a) => a.severity === "attention") && (
                  <Badge tone="accent" title={dict.alerts.severity.attention}>
                    <CircleDot size={11} strokeWidth={2.5} />
                  </Badge>
                )}
                {r.hasPain && <Badge tone="danger">{d.hasPain}</Badge>}
                {r.pendingPostCount > 0 && <Badge tone="warn">{d.pendingPost}</Badge>}
                {r.scheduledMissedYesterday === true && <Badge tone="warn">{d.schedMissed}</Badge>}
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="text-xs text-muted">
                    {r.athlete.athlete_code} · {r.group?.name ?? "—"}
                    {r.age ? ` · ${r.age}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  {r.todayScore !== null ? (
                    <>
                      <p
                        title={dict.common.readinessHint}
                        className={cn("score-num text-3xl font-bold leading-none", readinessTone(r.todayScore))}
                      >
                        {Math.round(r.todayScore)}
                      </p>
                      {r.readinessDelta !== null && (
                        <p className="mt-0.5 text-[10px] text-muted">
                          {r.readinessDelta > 0 ? "▲" : "▼"} {Math.abs(r.readinessDelta)}{" "}
                          {d.vsBaseline}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted">{d.noCheckinToday}</p>
                  )}
                </div>
              </div>

              {r.todayScore === null && r.lastKnownScore !== null && (
                <p className="mt-1 text-[11px] text-muted/80">
                  {d.lastResult}: {Math.round(r.lastKnownScore)} · {r.lastCheckinDate}
                  {r.lastCheckinAgeDays !== null &&
                    ` (${r.lastCheckinAgeDays} ${d.daysAgo})`}
                </p>
              )}
              {r.todayCheckin && r.lastCheckinAgeDays !== null && (
                <p className="mt-1 text-[11px] text-muted/80">
                  {d.tableLastCheckin}: {r.lastCheckinDate}
                </p>
              )}

              <div className="mt-2 flex items-end justify-between gap-2">
                <span className={cn("text-accent-2", !spark.length && "invisible")}>
                  <Sparkline points={spark} width={96} height={26} />
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="flex items-center gap-2">
                    {r.checkinDots.map((cd) => (
                      <span key={cd.date} className="flex gap-0.5" title={cd.date}>
                        <span
                          title={`${cd.date} · ${d.dotMorning}`}
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full border",
                            cd.morning
                              ? "border-ok bg-ok"
                              : cd.date === r.today
                                ? "border-warn bg-warn/30"
                                : "border-border bg-transparent",
                          )}
                        />
                        <span
                          title={`${cd.date} · ${d.dotEvening}`}
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full border",
                            cd.evening
                              ? "border-accent-2 bg-accent-2"
                              : cd.hadSession
                                ? "border-warn bg-warn/30"
                                : "border-border bg-transparent",
                          )}
                        />
                      </span>
                    ))}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-ok" /> {d.dotMorning}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-accent-2" /> {d.dotEvening}
                    </span>
                  </span>
                </span>
              </div>

              {r.baseline === null && r.observations > 0 && (
                <p className="mt-1.5 text-[11px] text-muted/70">
                  {d.normPending}: {r.observations} {d.obsOf} 8
                </p>
              )}
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-muted">{dict.common.noData}</p>
        )}
      </div>
    </div>
  );
}
