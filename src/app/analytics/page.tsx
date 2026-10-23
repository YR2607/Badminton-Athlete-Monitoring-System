import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { addDays, dateRange, resolveRange, type RangeKey } from "@/lib/dates";
import { athleteStats, periodSummary, delta, type AthletePeriodStats } from "@/lib/analytics";
import type { Athlete, Alert, Group, MorningCheckin, Profile, TrainingSession } from "@/lib/types";
import { AnalyticsFilters, type AthleteOption } from "./filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function Delta({ d, invert }: { d: number | null; invert?: boolean }) {
  if (d === null || d === 0) return null;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={cn("text-xs font-normal", good ? "text-ok" : "text-danger")}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
    </span>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; athlete?: string; range?: string; from?: string; to?: string }>;
}) {
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const d = dict.analytics;
  const sp = await searchParams;
  const supabase = await createClient();
  const tz = me.timezone ?? "Europe/Chisinau";

  const range = resolveRange((sp.range as RangeKey) || "7d", tz, { from: sp.from, to: sp.to });
  const days = dateRange(range.from, range.to);
  const prevDays = days.map((day) => addDays(day, -days.length));
  const prevFrom = prevDays[0];

  const [{ data: athletes }, { data: memberships }, { data: groups }, { data: profs }] =
    await Promise.all([
      supabase.from("athletes").select("*"),
      supabase.from("group_memberships").select("athlete_id, group_id").is("left_at", null),
      supabase.from("groups").select("*").order("name"),
      supabase.from("profiles").select("*"),
    ]);

  const groupById = new Map(((groups as Group[]) ?? []).map((g) => [g.id, g]));
  const profById = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
  const groupOfAthlete = new Map<string, string>();
  for (const m of (memberships as { athlete_id: string; group_id: string }[] | null) ?? []) {
    if (!groupOfAthlete.has(m.athlete_id)) groupOfAthlete.set(m.athlete_id, m.group_id);
  }

  const allAthletes = (athletes as Athlete[]) ?? [];

  // Scope: single athlete > group > everything visible
  let scoped = allAthletes;
  if (sp.athlete) {
    scoped = allAthletes.filter((a) => a.id === sp.athlete);
  } else if (sp.group) {
    scoped = allAthletes.filter((a) => groupOfAthlete.get(a.id) === sp.group);
  }
  const ids = scoped.map((a) => a.id);

  const [{ data: checkins }, { data: sessions }, { data: alerts }] = ids.length
    ? await Promise.all([
        supabase
          .from("morning_checkins")
          .select("*")
          .in("athlete_id", ids)
          .gte("checkin_date", prevFrom)
          .lte("checkin_date", range.to),
        supabase
          .from("training_sessions")
          .select("*")
          .in("athlete_id", ids)
          .gte("started_at", `${prevFrom}T00:00:00Z`)
          .lte("started_at", `${range.to}T23:59:59Z`),
        supabase
          .from("alerts")
          .select("*")
          .in("athlete_id", ids)
          .gte("triggered_at", `${prevFrom}T00:00:00Z`)
          .lte("triggered_at", `${range.to}T23:59:59Z`),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const inRange = (date: string) => date >= range.from && date <= range.to;
  const inPrev = (date: string) => date >= prevFrom && date <= addDays(range.from, -1);

  const checkinsAll = (checkins as MorningCheckin[]) ?? [];
  const sessionsAll = (sessions as TrainingSession[]) ?? [];
  const alertsAll = (alerts as Alert[]) ?? [];

  const stats: AthletePeriodStats[] = scoped.map((a) =>
    athleteStats(
      a.id,
      days,
      checkinsAll.filter((c) => c.athlete_id === a.id && inRange(c.checkin_date)),
      sessionsAll.filter((s) => s.athlete_id === a.id && inRange(s.started_at.slice(0, 10))),
      alertsAll.filter((al) => al.athlete_id === a.id && inRange(al.triggered_at.slice(0, 10))),
    ),
  );
  const prevStats = scoped.map((a) =>
    athleteStats(
      a.id,
      prevDays,
      checkinsAll.filter((c) => c.athlete_id === a.id && inPrev(c.checkin_date)),
      sessionsAll.filter((s) => s.athlete_id === a.id && inPrev(s.started_at.slice(0, 10))),
      [],
    ),
  );

  const summary = periodSummary(stats);
  const prevSummary = periodSummary(prevStats);
  const single = scoped.length === 1 ? stats[0] : null;

  const athleteOptions: AthleteOption[] = allAthletes.map((a) => ({
    id: a.id,
    label: `${profById.get(a.profile_id)?.display_name ?? a.athlete_code} (${a.athlete_code})`,
    groupId: groupOfAthlete.get(a.id) ?? null,
  }));

  const nameOf = (id: string) => {
    const a = scoped.find((x) => x.id === id);
    return a ? (profById.get(a.profile_id)?.display_name ?? a.athlete_code) : id;
  };

  const statCards: [string, string | number, number | null, boolean?, string?][] = [
    [d.checkins, `${summary.checkinsFilled}/${summary.checkinsExpected}`, delta(summary.fillRate, prevSummary.fillRate)],
    [d.sessions, summary.sessions, delta(summary.sessions, prevSummary.sessions)],
    [d.totalLoad, summary.totalLoad, delta(summary.totalLoad, prevSummary.totalLoad), undefined, dict.common.loadHint],
    [d.avgReadiness, summary.avgReadiness ?? "—", delta(summary.avgReadiness, prevSummary.avgReadiness), undefined, dict.common.readinessHint],
    [d.alertsCount, summary.alerts, delta(summary.alerts, prevSummary.alerts), true],
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{d.title}</h1>
        <p className="text-sm text-muted">{d.hint}</p>
      </div>

      <AnalyticsFilters
        dict={dict}
        groups={(groups as Group[]) ?? []}
        athletes={athleteOptions}
        current={{
          group: sp.group ?? "",
          athlete: sp.athlete ?? "",
          range: sp.range ?? "7d",
          from: sp.from,
          to: sp.to,
        }}
      />

      {scoped.length === 0 ? (
        <p className="text-sm text-muted">{d.noAthletes}</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {statCards.map(([label, value, dl, invert, hint]) => (
              <Card key={label as string}>
                <CardContent className="pt-3 pb-3">
                  <p className="text-lg font-bold tabular-nums">
                    {value} <Delta d={dl} invert={invert} />
                  </p>
                  <p className="text-xs text-muted" title={hint}>{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Fill matrix: athlete × day */}
          {!single && days.length <= 31 && (
            <Card>
              <CardHeader>
                <CardTitle>{d.completion}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="sticky left-0 bg-surface pb-2 pr-2 font-medium" />
                        {days.map((day) => (
                          <th key={day} className="pb-2 text-center font-medium">
                            {day.slice(8)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => (
                        <tr key={s.athleteId} className="border-t border-border/50">
                          <td className="sticky left-0 max-w-32 truncate bg-surface py-1.5 pr-2 font-medium">
                            <Link href={`/coach/athletes/${s.athleteId}`} className="text-accent">
                              {nameOf(s.athleteId)}
                            </Link>
                          </td>
                          {s.cells.map((c) => (
                            <td key={c.date} className="py-1.5 text-center">
                              <Link
                                href={`/coach/athletes/${s.athleteId}/day/${c.date}`}
                                className={cn(
                                  "inline-block h-3 w-3 rounded-full",
                                  c.hasPain
                                    ? "bg-danger"
                                    : c.filled
                                      ? "bg-ok"
                                      : "bg-foreground/15",
                                )}
                                title={`${c.date} — ${c.hasPain ? d.painDay : c.filled ? d.filled : d.missed}`}
                              />
                            </td>
                          ))}
                          <td className="py-1.5 pl-2 font-semibold tabular-nums">{s.rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-ok" /> {d.filled}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-foreground/15" /> {d.missed}</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-danger" /> {d.painDay}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-athlete cards (multi) */}
          {!single && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted">{d.byAthlete}</h2>
              {stats.map((s) => {
                const prev = prevStats.find((p) => p.athleteId === s.athleteId);
                const a = scoped.find((x) => x.id === s.athleteId)!;
                return (
                  <Link key={s.athleteId} href={`/coach/athletes/${s.athleteId}`} className="block">
                    <Card className="transition-colors hover:border-accent/50">
                      <CardContent className="space-y-2 pt-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{nameOf(s.athleteId)}</span>
                            <span className="text-xs text-muted">
                              {groupById.get(groupOfAthlete.get(a.id) ?? "")?.name ?? ""}
                            </span>
                          </div>
                          <span
                            title={dict.common.readinessHint}
                            className={cn(
                              "shrink-0 text-lg font-bold tabular-nums",
                              s.avgReadiness === null
                                ? "text-muted"
                                : s.avgReadiness >= 70
                                  ? "text-ok"
                                  : s.avgReadiness >= 45
                                    ? "text-warn"
                                    : "text-danger",
                            )}
                          >
                            {s.avgReadiness ?? "—"}
                            {prev && <Delta d={delta(s.avgReadiness, prev.avgReadiness)} />}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          <span>
                            {d.checkins}: {s.filled}/{s.expected} ({s.rate}%)
                          </span>
                          <span>
                            {d.totalLoad}: <b className="text-foreground">{s.totalLoad}</b>
                            {prev && <Delta d={delta(s.totalLoad, prev.totalLoad)} />}
                          </span>
                          <span>{d.sessions}: {s.sessions}</span>
                          {s.painDays > 0 && <Badge tone="danger">{d.painDays}: {s.painDays}</Badge>}
                          {s.alerts > 0 && <Badge tone="warn">{d.alertsCount}: {s.alerts}</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Single athlete: day-by-day */}
          {single && (
            <Card>
              <CardHeader>
                <CardTitle>{d.byDay}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border/60">
                  {[...single.cells].reverse().map((c) => {
                    const ci = checkinsAll.find(
                      (x) => x.athlete_id === single.athleteId && x.checkin_date === c.date,
                    );
                    const daySessions = sessionsAll.filter(
                      (s) => s.athlete_id === single.athleteId && s.started_at.slice(0, 10) === c.date,
                    );
                    return (
                      <Link
                        key={c.date}
                        href={`/coach/athletes/${single.athleteId}/day/${c.date}`}
                        className="flex items-center gap-3 py-2 text-sm active:bg-foreground/[0.03]"
                      >
                        <span className="w-20 shrink-0 font-medium">{c.date}</span>
                        <span
                          className={cn(
                            "h-3 w-3 shrink-0 rounded-full",
                            c.hasPain ? "bg-danger" : c.filled ? "bg-ok" : "bg-foreground/15",
                          )}
                        />
                        <span className="min-w-0 flex-1 text-muted">
                          {c.filled ? (
                            <>
                              {dict.history.sleep} {ci!.sleep_score} · {dict.history.fatigue}{" "}
                              {ci!.fatigue_score} · {dict.history.mood} {ci!.mood_score}
                              {c.hasPain ? ` · ${d.painDay}!` : ""}
                            </>
                          ) : (
                            d.missed
                          )}
                        </span>
                        {daySessions.length > 0 && (
                          <span className="shrink-0 text-xs text-muted tabular-nums">
                            {d.sessions}: {daySessions.length} · {d.totalLoad}{" "}
                            {daySessions.reduce((a, s) => a + s.session_load, 0)}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
