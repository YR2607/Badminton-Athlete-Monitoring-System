import { describe, expect, it } from "vitest";
import {
  bergerRounds,
  computeStandings,
  matchKey,
  parseScoreInput,
  summarizeAthleteTournaments,
} from "@/lib/tournaments";
import type { Tournament, TournamentMatch, TournamentPlayer } from "@/lib/types";

describe("matchKey", () => {
  it("normalizes seed order", () => {
    expect(matchKey(1, 3)).toBe("1-3");
    expect(matchKey(3, 1)).toBe("1-3");
  });
});

describe("parseScoreInput", () => {
  it("parses common separators", () => {
    expect(parseScoreInput("21:15")).toEqual({ x: 21, y: 15 });
    expect(parseScoreInput("21-15")).toEqual({ x: 21, y: 15 });
    expect(parseScoreInput("21 15")).toEqual({ x: 21, y: 15 });
    expect(parseScoreInput("21/15")).toEqual({ x: 21, y: 15 });
  });

  it("parses compact 4-digit input", () => {
    expect(parseScoreInput("2115")).toEqual({ x: 21, y: 15 });
    expect(parseScoreInput("1103")).toEqual({ x: 11, y: 3 });
  });

  it("rejects ties, junk and out-of-range scores", () => {
    expect(parseScoreInput("")).toBeNull();
    expect(parseScoreInput("21:21")).toBeNull();
    expect(parseScoreInput("abc")).toBeNull();
    expect(parseScoreInput("21")).toBeNull();
    expect(parseScoreInput("121:15")).toBeNull();
  });
});

describe("bergerRounds", () => {
  it("produces a full round-robin for 2..10 players", () => {
    for (let n = 2; n <= 10; n++) {
      const rounds = bergerRounds(n);
      const seen = new Set<string>();
      for (const round of rounds) {
        const busy = new Set<number>();
        for (const [a, b] of round) {
          expect(a).not.toBe(b);
          expect(busy.has(a)).toBe(false);
          expect(busy.has(b)).toBe(false);
          busy.add(a);
          busy.add(b);
          const k = matchKey(a, b);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
      expect(seen.size).toBe((n * (n - 1)) / 2);
      // even n: n-1 rounds; odd n: n rounds (with bye)
      expect(rounds.length).toBe(n % 2 === 0 ? n - 1 : n);
    }
  });

  it("returns empty for fewer than 2 players", () => {
    expect(bergerRounds(0)).toEqual([]);
    expect(bergerRounds(1)).toEqual([]);
  });
});

const players = (names: string[]): TournamentPlayer[] =>
  names.map((name, i) => ({
    id: `p${i}`,
    tournament_id: "t1",
    seed: i,
    display_name: name,
    athlete_id: null,
  }));

const match = (a: number, b: number, sa: number, sb: number): TournamentMatch => ({
  id: `m${a}-${b}`,
  tournament_id: "t1",
  player_a_seed: Math.min(a, b),
  player_b_seed: Math.max(a, b),
  score_a: a < b ? sa : sb,
  score_b: a < b ? sb : sa,
  updated_at: "",
});

describe("computeStandings", () => {
  it("ranks by wins, then head-to-head", () => {
    const ps = players(["A", "B", "C"]);
    const ms = [match(0, 1, 21, 10), match(0, 2, 15, 21), match(1, 2, 21, 15)];
    const st = computeStandings(ps, ms);
    // A and B both 1 win → A won head-to-head
    expect(st.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(st[0]).toMatchObject({ wins: 1, place: 1, diff: 5 });
    expect(st[2]).toMatchObject({ wins: 1, place: 3 });
  });

  it("falls back to point diff when no head-to-head", () => {
    const ps = players(["A", "B", "C", "D"]);
    // A(+16), C(+11), B(+2) all beat D once → 1 win each, no mutual matches
    const ms = [match(0, 3, 21, 5), match(1, 3, 21, 19), match(2, 3, 21, 10)];
    const st = computeStandings(ps, ms);
    expect(st[0].name).toBe("A");
    expect(st[1].name).toBe("C");
    expect(st[2].name).toBe("B");
  });

  it("counts played/losses/points correctly", () => {
    const ps = players(["A", "B"]);
    const st = computeStandings(ps, [match(0, 1, 11, 7)]);
    expect(st[0]).toMatchObject({ played: 1, wins: 1, losses: 0, pointsFor: 11, pointsAgainst: 7 });
    expect(st[1]).toMatchObject({ played: 1, wins: 0, losses: 1 });
  });
});

describe("summarizeAthleteTournaments", () => {
  const t2: Tournament = {
    id: "t2",
    title: "T2",
    played_on: "2026-11-01",
    courts: 4,
    status: "active",
    created_by: null,
    created_at: "",
  };

  it("aggregates record, win rate and best place across tournaments", () => {
    const tourneys: Tournament[] = [
      { id: "t1", title: "T1", played_on: "2026-10-01", courts: 4, status: "completed", created_by: null, created_at: "" },
      t2,
    ];
    const ps: TournamentPlayer[] = [
      ...players(["Me", "B", "C"]),
      { id: "q0", tournament_id: "t2", seed: 0, display_name: "Me", athlete_id: "ath1" },
      { id: "q1", tournament_id: "t2", seed: 1, display_name: "D", athlete_id: null },
      { id: "q2", tournament_id: "t2", seed: 2, display_name: "E", athlete_id: null },
    ];
    ps[0].athlete_id = "ath1";
    const ms: TournamentMatch[] = [
      match(0, 1, 21, 10), // t1: Me beats B
      match(0, 2, 21, 10), // t1: Me beats C → 1st place
      match(1, 2, 21, 15),
      { ...match(0, 1, 10, 21), id: "t2m1", tournament_id: "t2" }, // t2: Me loses to D
      { ...match(0, 2, 21, 18), id: "t2m2", tournament_id: "t2" }, // t2: Me beats E
      { ...match(1, 2, 21, 10), id: "t2m3", tournament_id: "t2" },
    ];

    const s = summarizeAthleteTournaments("ath1", tourneys, ps, ms);
    expect(s.tournamentsPlayed).toBe(2);
    expect(s.matchesPlayed).toBe(4);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(75);
    expect(s.bestPlace).toBe(1);
    expect(s.placements).toHaveLength(2);
    expect(s.placements.find((p) => p.tournamentId === "t2")).toMatchObject({ place: 2, total: 3 });
    expect(s.matches.every((m) => m.opponentName !== "Me")).toBe(true);
  });

  it("returns zeros for an athlete without tournaments", () => {
    const s = summarizeAthleteTournaments("nobody", [], [], []);
    expect(s).toMatchObject({ tournamentsPlayed: 0, matchesPlayed: 0, winRate: null, bestPlace: null });
  });
});
