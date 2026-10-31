"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { CoachAthleteRow } from "@/lib/coach-data";
import { STATUS_ORDER, type AthleteStatus } from "@/lib/athlete-status";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Sparkline } from "@/components/charts/sparkline";
import { avatarPublicUrl, getAvatarPreset } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import type { Group, Locale } from "@/lib/types";

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
  locale,
}: {
  rows: CoachAthleteRow[];
  groups: Group[];
  dict: Dictionary;
  locale: Locale;
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
          const preset = r.athlete.photo_path
            ? getAvatarPreset(r.athlete.photo_path)
            : undefined;
          // Cap the badge row: 7 possible status chips used to wrap into
          // 2–3 ragged lines on mobile and break the card layout.
          const badges: ReactNode[] = [
            <Badge key="st" tone={statusTone(r.status)} title={d.tipStatus}>
              {d.status[r.status]}
            </Badge>,
          ];
          if (r.openAlerts.some((a) => a.severity === "priority"))
            badges.push(
              <Badge key="ap" tone="danger" title={d.tipAlertP}>!</Badge>,
            );
          if (r.openAlerts.some((a) => a.severity === "review_load"))
            badges.push(
              <Badge key="ar" tone="warn" title={d.tipAlertR}>↺</Badge>,
            );
          if (r.openAlerts.some((a) => a.severity === "attention"))
            badges.push(
              <Badge key="aa" tone="accent" title={d.tipAlertA}>•</Badge>,
            );
          if (r.hasPain)
            badges.push(
              <Badge key="pain" tone="danger" title={d.tipPain}>{d.hasPain}</Badge>,
            );
          if (r.pendingPostCount > 0)
            badges.push(
              <Badge key="pp" tone="warn" title={d.tipPending}>{d.pendingPost}</Badge>,
            );
          if (r.scheduledMissedYesterday === true)
            badges.push(
              <Badge key="sm" tone="warn" title={d.tipMissed}>{d.schedMissed}</Badge>,
            );
          return (
            <Link
              key={r.athlete.id}
              href={`/coach/athletes/${r.athlete.id}`}
              className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40 active:bg-foreground/[0.03]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {badges.slice(0, 4)}
                {badges.length > 4 && (
                  <Badge tone="neutral" title={badges.slice(4).length.toString()}>
                    +{badges.length - 4}
                  </Badge>
                )}
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {preset && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarPublicUrl(r.athlete.photo_path!)}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{name}</p>
                    <p className="truncate text-xs text-muted">
                      {r.athlete.athlete_code} · {r.group?.name ?? "—"}
                      {r.age ? ` · ${r.age}` : ""}
                    </p>
                    {preset && (
                      <p className="truncate text-[10px] leading-tight text-muted/70">
                        {preset.emoji} {preset.title[locale]}
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {r.todayScore !== null ? (
                    <>
                      <p
                        title={dict.common.readinessHint}
                        className={cn("text-xl font-bold tabular-nums leading-none", readinessTone(r.todayScore))}
                      >
                        {Math.round(r.todayScore)}
                      </p>
                      {r.readinessDelta !== null && (
                        <p className="mt-0.5 text-[10px] text-muted" title={d.tipDelta}>
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

              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <span
                  title={d.tipSpark}
                  className={cn("text-accent", !spark.length && "invisible")}
                >
                  <Sparkline points={spark} width={84} height={24} />
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="flex items-center gap-1 sm:gap-2">
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
                              ? "border-accent bg-accent"
                              : cd.hadSession
                                ? "border-warn bg-warn/30"
                                : "border-border bg-transparent",
                          )}
                        />
                      </span>
                    ))}
                  </span>
                  <span className="text-[10px] text-muted">
                    {d.dotMorning} ● / {d.dotEvening} ●
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
