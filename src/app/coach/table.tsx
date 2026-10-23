"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { CoachAthleteRow } from "@/lib/coach-data";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";
import type { Group } from "@/lib/types";

type SortKey = "name" | "readiness" | "load" | "alerts";

function readinessTone(v: number | null): string {
  if (v === null) return "text-muted";
  if (v >= 70) return "text-ok";
  if (v >= 45) return "text-warn";
  return "text-danger";
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
  const [painOnly, setPainOnly] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");

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
    if (painOnly) out = out.filter((r) => r.hasPain);
    if (missedOnly) out = out.filter((r) => !r.todayCheckin);
    return [...out].sort((a, b) => {
      switch (sort) {
        case "readiness":
          return (a.readiness ?? -1) - (b.readiness ?? -1);
        case "load":
          return (b.lastLoad ?? -1) - (a.lastLoad ?? -1);
        case "alerts":
          return b.openAlerts.length - a.openAlerts.length;
        default:
          return (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? "");
      }
    });
  }, [rows, q, groupId, painOnly, missedOnly, sort]);

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
        <label className="flex min-h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={painOnly} onChange={(e) => setPainOnly(e.target.checked)} />
          {d.hasPain}
        </label>
        <label className="flex min-h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} />
          {d.missedCheckins}
        </label>
        <Select className="w-36" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">{d.tableAthlete}</option>
          <option value="readiness">{d.tableReadiness}</option>
          <option value="load">{d.tableLastLoad}</option>
          <option value="alerts">{d.tableAlerts}</option>
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
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="text-xs text-muted">
                    {r.athlete.athlete_code} · {r.group?.name ?? "—"}
                    {r.age ? ` · ${r.age}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    title={dict.common.readinessHint}
                    className={cn("text-xl font-bold tabular-nums leading-none", readinessTone(r.readiness))}
                  >
                    {r.readiness !== null ? Math.round(r.readiness) : "—"}
                  </p>
                  {r.readinessDelta !== null && (
                    <p className="mt-0.5 text-[10px] text-muted">
                      {r.readinessDelta > 0 ? "▲" : "▼"} {Math.abs(r.readinessDelta)}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-end justify-between gap-2">
                <span className={cn("text-accent", !spark.length && "invisible")}>
                  <Sparkline points={spark} width={96} height={26} />
                </span>
                <span className="text-xs text-muted">
                  {d.tableSleep} {r.todayCheckin?.sleep_score ?? "—"} · {d.tableFatigue}{" "}
                  {r.todayCheckin?.fatigue_score ?? "—"} · {d.tableLastLoad} {r.lastLoad ?? "—"}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-1.5">
                {r.todayCheckin ? (
                  <Badge tone="ok">✓</Badge>
                ) : (
                  <Badge tone="warn">{d.missingToday}</Badge>
                )}
                {r.openAlerts.some((a) => a.severity === "priority") && <Badge tone="danger">!</Badge>}
                {r.openAlerts.some((a) => a.severity === "review_load") && <Badge tone="warn">↺</Badge>}
                {r.openAlerts.some((a) => a.severity === "attention") && <Badge tone="accent">•</Badge>}
                {r.hasPain && <Badge tone="danger">{d.hasPain}</Badge>}
              </div>
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
