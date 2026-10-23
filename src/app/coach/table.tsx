"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { CoachAthleteRow } from "@/lib/coach-data";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
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
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Input
          className="w-48"
          placeholder={dict.common.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-44" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{d.filterByGroup}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={painOnly} onChange={(e) => setPainOnly(e.target.checked)} />
          {d.hasPain}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} />
          {d.missedCheckins}
        </label>
        <Select className="w-40 ml-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">{d.tableAthlete}</option>
          <option value="readiness">{d.tableReadiness}</option>
          <option value="load">{d.tableLastLoad}</option>
          <option value="alerts">{d.tableAlerts}</option>
        </Select>
      </div>
      {/* Mobile: cards */}
      <div className="divide-y divide-border md:hidden">
        {filtered.map((r) => (
          <Link
            key={r.athlete.id}
            href={`/coach/athletes/${r.athlete.id}`}
            className="block px-3 py-3 active:bg-foreground/[0.03]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.profile?.display_name ?? r.athlete.athlete_code}</span>
              <span className={cn("text-lg font-bold tabular-nums", readinessTone(r.readiness))}>
                {r.readiness !== null ? Math.round(r.readiness) : "—"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{r.group?.name ?? "—"}</span>
              <span>
                {d.tableSleep} {r.todayCheckin?.sleep_score ?? "—"} · {d.tableFatigue}{" "}
                {r.todayCheckin?.fatigue_score ?? "—"} · {d.tableLastLoad} {r.lastLoad ?? "—"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
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
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-muted">{dict.common.noData}</p>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">{d.tableAthlete}</th>
              <th className="px-3 py-2 font-medium">{d.tableGroup}</th>
              <th className="px-3 py-2 font-medium">{d.tableAge}</th>
              <th className="px-3 py-2 font-medium">{d.tableLastCheckin}</th>
              <th className="px-3 py-2 font-medium">{d.tableSleep}</th>
              <th className="px-3 py-2 font-medium">{d.tableRecovery}</th>
              <th className="px-3 py-2 font-medium">{d.tableFatigue}</th>
              <th className="px-3 py-2 font-medium">{d.tableSoreness}</th>
              <th className="px-3 py-2 font-medium">{d.tableReadiness}</th>
              <th className="px-3 py-2 font-medium">{d.tableLastLoad}</th>
              <th className="px-3 py-2 font-medium">{d.tableAlerts}</th>
              <th className="px-3 py-2 font-medium">{d.tableStatus}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.athlete.id} className="border-b border-border last:border-0 hover:bg-foreground/[0.02]">
                <td className="px-3 py-2">
                  <Link href={`/coach/athletes/${r.athlete.id}`} className="font-medium text-accent hover:underline">
                    {r.profile?.display_name ?? r.athlete.athlete_code}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{r.group?.name ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{r.age ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{r.lastCheckinDate ?? "—"}</td>
                <td className="px-3 py-2">{r.todayCheckin?.sleep_score ?? "—"}</td>
                <td className="px-3 py-2">{r.todayCheckin?.recovery_score ?? "—"}</td>
                <td className="px-3 py-2">{r.todayCheckin?.fatigue_score ?? "—"}</td>
                <td className="px-3 py-2">{r.todayCheckin?.muscle_soreness_score ?? "—"}</td>
                <td className={cn("px-3 py-2 font-semibold", readinessTone(r.readiness))}>
                  {r.readiness !== null ? Math.round(r.readiness) : "—"}
                  {r.readinessDelta !== null && (
                    <span className="ml-1 text-xs font-normal text-muted">
                      ({r.readinessDelta > 0 ? "+" : ""}
                      {r.readinessDelta})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{r.lastLoad ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.openAlerts.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span className="flex gap-1">
                      {r.openAlerts.some((a) => a.severity === "priority") && (
                        <Badge tone="danger">!</Badge>
                      )}
                      {r.openAlerts.some((a) => a.severity === "review_load") && (
                        <Badge tone="warn">↺</Badge>
                      )}
                      {r.openAlerts.some((a) => a.severity === "attention") && (
                        <Badge tone="accent">•</Badge>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.todayCheckin ? (
                    <Badge tone="ok">✓</Badge>
                  ) : (
                    <Badge tone="warn">{d.missingToday}</Badge>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted">
                  {dict.common.noData}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
