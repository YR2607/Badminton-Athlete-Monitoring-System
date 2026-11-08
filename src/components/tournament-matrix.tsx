"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bergerRounds,
  computeStandings,
  matchKey,
  parseScoreInput,
} from "@/lib/tournaments";
import {
  deleteTournamentAction,
  importTournamentJsonAction,
  linkPlayerAthleteAction,
  saveMatchScoreAction,
} from "@/app/actions/tournaments";
import type { Dictionary } from "@/i18n";
import type { Tournament, TournamentMatch, TournamentPlayer } from "@/lib/types";

export function TournamentMatrixView({
  tournament,
  players,
  matches,
  d,
  athletes = [],
  myAthleteId = null,
  editable = false,
}: {
  tournament: Tournament;
  players: TournamentPlayer[];
  matches: TournamentMatch[];
  d: Dictionary["tournaments"];
  athletes?: { id: string; name: string }[];
  myAthleteId?: string | null;
  editable?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"matrix" | "rounds" | "ranking" | "links">("matrix");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const sortedPlayers = [...players].sort((a, b) => a.seed - b.seed);
  const n = sortedPlayers.length;
  const totalMatches = (n * (n - 1)) / 2;

  const [localScores, setLocalScores] = useState<Map<string, { a: number; b: number }>>(() => {
    const m = new Map<string, { a: number; b: number }>();
    for (const x of matches) {
      m.set(matchKey(x.player_a_seed, x.player_b_seed), { a: x.score_a, b: x.score_b });
    }
    return m;
  });

  const virtualMatches: TournamentMatch[] = [...localScores.entries()].map(([k, v]) => {
    const [sa, sb] = k.split("-").map(Number);
    return {
      id: k,
      tournament_id: tournament.id,
      player_a_seed: sa,
      player_b_seed: sb,
      score_a: v.a,
      score_b: v.b,
      updated_at: "",
    };
  });

  const standings = computeStandings(sortedPlayers, virtualMatches);
  const placeBySeed = new Map(standings.map((s) => [s.seed, s.place]));
  const winsBySeed = new Map(standings.map((s) => [s.seed, s.wins]));
  const doneCount = localScores.size;
  const maxWins = standings.length ? Math.max(...standings.map((s) => s.wins)) : 0;
  const leaders = standings.filter((s) => s.wins === maxWins && maxWins > 0);
  const rounds = bergerRounds(n);
  const mySeed = myAthleteId
    ? (sortedPlayers.find((p) => p.athlete_id === myAthleteId)?.seed ?? null)
    : null;

  const getScore = (i: number, j: number) => {
    const v = localScores.get(matchKey(i, j));
    if (!v) return null;
    return i < j ? { a: v.a, b: v.b } : { a: v.b, b: v.a };
  };

  const handleScoreCommit = (seedA: number, seedB: number, raw: string) => {
    const k = matchKey(seedA, seedB);
    const trimmed = raw.trim();
    if (!trimmed) {
      setLocalScores((prev) => {
        const next = new Map(prev);
        next.delete(k);
        return next;
      });
    } else {
      const p = parseScoreInput(trimmed);
      if (!p) {
        setStatusMsg(d.invalidScore);
        return;
      }
      const val = seedA < seedB ? { a: p.x, b: p.y } : { a: p.y, b: p.x };
      setLocalScores((prev) => new Map(prev).set(k, val));
    }
    setStatusMsg(d.saving);
    startTransition(async () => {
      const res = await saveMatchScoreAction({
        tournamentId: tournament.id,
        seedA,
        seedB,
        rawScore: trimmed,
      });
      setStatusMsg(
        res.ok ? d.savedOk : res.error === "bad_score" ? d.errScore : (res.error ?? d.saveErr),
      );
    });
  };

  const exportJson = () => {
    const obj: Record<string, { a: number; b: number }> = {};
    for (const [k, v] of localScores.entries()) obj[k] = v;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            title: tournament.title,
            playedOn: tournament.played_on,
            players: sortedPlayers.map((p) => p.display_name),
            results: obj,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `tournament-${tournament.played_on}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  const exportCsv = () => {
    const header = [
      d.colPlayer,
      ...sortedPlayers.map((p) => p.display_name),
      d.colWins,
      d.colPlace,
    ];
    const rows: (string | number)[][] = [header];
    for (const p of sortedPlayers) {
      const row: (string | number)[] = [p.display_name];
      for (const q of sortedPlayers) {
        if (p.seed === q.seed) row.push("—");
        else {
          const s = getScore(p.seed, q.seed);
          row.push(s ? `${s.a}:${s.b}` : "");
        }
      }
      row.push(winsBySeed.get(p.seed) ?? 0, placeBySeed.get(p.seed) ?? "");
      rows.push(row);
    }
    const csv =
      "\uFEFF" +
      rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const u = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = `tournament-${tournament.played_on}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  const handleImportJson = async (file: File) => {
    try {
      const d = JSON.parse(await file.text());
      if (!d.results || typeof d.results !== "object") throw new Error("bad json");
      startTransition(async () => {
        const res = await importTournamentJsonAction({
          tournamentId: tournament.id,
          results: d.results,
        });
        if (res.ok) {
          setStatusMsg(d.importedN.replace("{n}", String(res.count)));
          router.refresh();
        }
      });
    } catch {
      setStatusMsg(d.badJson);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xl font-bold tabular-nums">{doneCount} / {totalMatches}</div>
          <div className="text-xs text-muted">{d.doneLabel}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xl font-bold tabular-nums">{totalMatches - doneCount}</div>
          <div className="text-xs text-muted">{d.leftLabel}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xl font-bold truncate">
            {leaders.length === 0
              ? "—"
              : leaders.length === 1
                ? leaders[0].name
                : `${leaders[0].name} (${d.leadersMore.replace("{n}", String(leaders.length - 1))})`}
          </div>
          <div className="text-xs text-muted">{d.leaderLabel}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xl font-bold tabular-nums">{maxWins}</div>
          <div className="text-xs text-muted">{d.leaderWinsLabel}</div>
        </div>
      </div>

      {/* Athlete's own matches highlight */}
      {mySeed !== null && (
        <section className="rounded-xl border border-accent/40 bg-accent/5 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {d.myGames} · {d.colPlace} #{placeBySeed.get(mySeed)} · {d.colWins}: {winsBySeed.get(mySeed)}/{n - 1}
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sortedPlayers
              .filter((p) => p.seed !== mySeed)
              .map((opp) => {
                const s = getScore(mySeed, opp.seed);
                const won = s ? s.a > s.b : null;
                return (
                  <div
                    key={opp.seed}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                      won === true
                        ? "border-ok/40 bg-ok/10"
                        : won === false
                          ? "border-danger/30 bg-danger/5"
                          : "border-border bg-surface"
                    }`}
                  >
                    <span className="truncate font-medium">vs {opp.display_name}</span>
                    <span className="ml-2 font-bold tabular-nums">
                      {s ? `${s.a}:${s.b}` : "—"}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Sub-tabs + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["matrix", d.tabMatrix],
              ["rounds", d.tabRounds],
              ["ranking", d.tabRanking],
              ...(editable ? ([["links", d.tabLinks]] as const) : []),
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                tab === k ? "border-accent bg-accent text-white" : "border-border bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {statusMsg && <span className="text-muted">{statusMsg}</span>}
          <button type="button" onClick={exportJson} className="rounded-lg border border-border bg-surface px-2.5 py-1.5">
            JSON
          </button>
          {editable && (
            <label className="cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5">
              {d.importJsonBtn}
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportJson(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <button type="button" onClick={exportCsv} className="rounded-lg border border-border bg-surface px-2.5 py-1.5">
            CSV
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-lg border border-border bg-surface px-2.5 py-1.5">
            {d.printBtn}
          </button>
        </div>
      </div>

      {/* Tab 1: Matrix */}
      {tab === "matrix" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[780px] border-collapse text-xs">
            <thead>
              <tr className="bg-foreground/5">
                <th className="w-8 border border-border p-2 text-center">{d.colNum}</th>
                <th className="min-w-[140px] border border-border p-2 text-left">{d.colPlayer}</th>
                {sortedPlayers.map((p) => (
                  <th key={p.seed} className="w-14 border border-border p-2 text-center">
                    {p.seed + 1}
                  </th>
                ))}
                <th className="w-14 border border-border p-2 text-center font-bold">{d.colWins}</th>
                <th className="w-14 border border-border p-2 text-center font-bold">{d.colPlace}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((rowP) => {
                const isMe = rowP.seed === mySeed;
                return (
                  <tr key={rowP.seed} className={isMe ? "bg-accent/10" : ""}>
                    <th className="border border-border bg-foreground/5 p-2 text-center">
                      {rowP.seed + 1}
                    </th>
                    <th className="border border-border p-2 text-left font-semibold">
                      {rowP.athlete_id && editable ? (
                        <Link href={`/coach/athletes/${rowP.athlete_id}`} className="text-accent hover:underline">
                          {rowP.display_name}
                        </Link>
                      ) : (
                        rowP.display_name
                      )}
                    </th>
                    {sortedPlayers.map((colP) => {
                      if (rowP.seed === colP.seed) {
                        return <td key={colP.seed} className="border border-border bg-foreground/80" />;
                      }
                      const s = getScore(rowP.seed, colP.seed);
                      const won = s ? s.a > s.b : null;
                      const isUpper = rowP.seed < colP.seed;
                      if (editable && isUpper) {
                        return (
                          <td
                            key={colP.seed}
                            className={`border border-border p-0 text-center ${
                              won === true ? "bg-ok/15 font-bold" : ""
                            }`}
                          >
                            <input
                              key={`${rowP.seed}-${colP.seed}-${s ? `${s.a}:${s.b}` : ""}`}
                              defaultValue={s ? `${s.a}:${s.b}` : ""}
                              placeholder="—"
                              onBlur={(e) => {
                                const cur = s ? `${s.a}:${s.b}` : "";
                                if (e.target.value.trim() !== cur) {
                                  handleScoreCommit(rowP.seed, colP.seed, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              className="w-full bg-transparent py-2 text-center text-xs font-semibold tabular-nums focus:bg-accent/10 focus:outline-none"
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={colP.seed}
                          className={`border border-border p-2 text-center tabular-nums ${
                            !isUpper ? "bg-foreground/[0.03] text-muted" : ""
                          } ${won === true ? "bg-ok/15 font-bold text-ok" : ""}`}
                        >
                          {s ? `${s.a}:${s.b}` : ""}
                        </td>
                      );
                    })}
                    <td className="border border-border bg-foreground/5 p-2 text-center font-bold tabular-nums">
                      {winsBySeed.get(rowP.seed) ?? 0}
                    </td>
                    <td className="border border-border bg-foreground/5 p-2 text-center font-bold tabular-nums">
                      {placeBySeed.get(rowP.seed) ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Rounds & courts */}
      {tab === "rounds" && (
        <div className="space-y-3">
          {rounds.map((pairs, rIdx) => {
            const doneInRound = pairs.filter(([a, b]) => getScore(a, b) !== null).length;
            return (
              <div key={rIdx} className="rounded-xl border border-border bg-surface p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold">{d.roundN.replace("{n}", String(rIdx + 1))}</h3>
                  <span className="text-xs text-muted">
                    {d.roundProgress
                      .replace("{done}", String(doneInRound))
                      .replace("{total}", String(pairs.length))}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {pairs.map(([a, b], mIdx) => {
                    const pA = sortedPlayers[a];
                    const pB = sortedPlayers[b];
                    if (!pA || !pB) return null;
                    const s = getScore(a, b);
                    const courtLabel =
                      mIdx < tournament.courts
                        ? d.court.replace("{n}", String(mIdx + 1))
                        : d.freeCourt;
                    return (
                      <div
                        key={`${a}-${b}`}
                        className={`rounded-lg border p-2.5 text-xs ${
                          s ? "border-ok/40 bg-ok/5" : "border-border"
                        }`}
                      >
                        <div className="mb-1 text-[11px] text-muted">
                          {courtLabel} · {d.matchN.replace("{n}", String(mIdx + 1))}
                        </div>
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span className="truncate">{pA.display_name}</span>
                          {editable ? (
                            <input
                              key={`r-${a}-${b}-${s ? `${s.a}:${s.b}` : ""}`}
                              defaultValue={s ? `${s.a}:${s.b}` : ""}
                              placeholder="21:15"
                              onBlur={(e) => {
                                const cur = s ? `${s.a}:${s.b}` : "";
                                if (e.target.value.trim() !== cur) {
                                  handleScoreCommit(a, b, e.target.value);
                                }
                              }}
                              className="w-20 rounded border border-border bg-surface px-2 py-1 text-center font-bold tabular-nums"
                            />
                          ) : (
                            <span className="font-bold text-accent tabular-nums">
                              {s ? `${s.a}:${s.b}` : "—"}
                            </span>
                          )}
                          <span className="truncate text-right">{pB.display_name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 3: Ranking */}
      {tab === "ranking" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="p-2.5">{d.colPlace}</th>
                <th className="p-2.5">{d.colPlayer}</th>
                <th className="p-2.5">{d.colPlayed}</th>
                <th className="p-2.5">{d.colWins}</th>
                <th className="p-2.5">{d.colLosses}</th>
                <th className="p-2.5">{d.colPoints}</th>
                <th className="p-2.5">{d.colDiff}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {standings.map((r) => (
                <tr
                  key={r.seed}
                  className={`border-b border-border/50 last:border-0 ${
                    r.seed === mySeed ? "bg-accent/10 font-semibold" : ""
                  }`}
                >
                  <td className="p-2.5 font-bold">{r.place}</td>
                  <td className="p-2.5 font-medium">
                    {r.athleteId && editable ? (
                      <Link href={`/coach/athletes/${r.athleteId}`} className="text-accent hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="p-2.5">{r.played}/{n - 1}</td>
                  <td className="p-2.5 font-bold text-ok">{r.wins}</td>
                  <td className="p-2.5 text-muted">{r.losses}</td>
                  <td className="p-2.5 text-muted">{r.pointsFor}:{r.pointsAgainst}</td>
                  <td className="p-2.5 font-semibold">
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Link tournament rows to system athletes */}
      {tab === "links" && editable && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">
            {d.linksHint}
          </p>
          <div className="divide-y divide-border/60 text-sm">
            {sortedPlayers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">
                  #{p.seed + 1} · {p.display_name}
                </span>
                <select
                  defaultValue={p.athlete_id ?? ""}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    startTransition(async () => {
                      await linkPlayerAthleteAction({
                        playerId: p.id,
                        tournamentId: tournament.id,
                        athleteId: val,
                      });
                      setStatusMsg(d.linkSaved.replace("{name}", p.display_name));
                      router.refresh();
                    });
                  }}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs"
                >
                  <option value="">{d.guest}</option>
                  {athletes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                if (!confirm(d.deleteConfirm)) return;
                startTransition(async () => {
                  await deleteTournamentAction(tournament.id);
                  router.push("/coach/tournaments");
                });
              }}
              className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger"
            >
              {d.deleteBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
