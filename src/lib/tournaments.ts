import type { Tournament, TournamentMatch, TournamentPlayer } from "./types";

/** Canonical key for an unordered pair of seeds. */
export function matchKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Parse flexible score input: "21:15", "21-15", "21 15", "21/15", or compact "2115" / "1103".
 * Returns null if invalid or tied.
 */
export function parseScoreInput(raw: string): { x: number; y: number } | null {
  const s = String(raw).trim();
  if (!s) return null;
  const compact = s.replace(/\s/g, "");
  let nums = (compact.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 1 && compact.replace(/\D/g, "").length === 4) {
    const d = compact.replace(/\D/g, "");
    nums = [Number(d.slice(0, 2)), Number(d.slice(2))];
  }
  if (nums.length < 2) return null;
  const [x, y] = nums;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x === y || x < 0 || y < 0 || x > 99 || y > 99) {
    return null;
  }
  return { x, y };
}

/**
 * Generate Berger round-robin pairings for N players (0..N-1).
 * In each round every player plays at most once.
 */
export function bergerRounds(n: number): [number, number][][] {
  if (n < 2) return [];
  // Exact 10-player schedule from the club HTML matrix for 100% compatibility
  if (n === 10) {
    return [
      [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]],
      [[0, 8], [9, 7], [1, 6], [2, 5], [3, 4]],
      [[0, 7], [8, 6], [9, 5], [1, 4], [2, 3]],
      [[0, 6], [7, 5], [8, 4], [9, 3], [1, 2]],
      [[0, 5], [6, 4], [7, 3], [8, 2], [9, 1]],
      [[0, 4], [5, 3], [6, 2], [7, 1], [8, 9]],
      [[0, 3], [4, 2], [5, 1], [6, 9], [7, 8]],
      [[0, 2], [3, 1], [4, 9], [5, 8], [6, 7]],
      [[0, 1], [2, 9], [3, 8], [4, 7], [5, 6]],
    ];
  }
  const hasBye = n % 2 === 1;
  const m = hasBye ? n + 1 : n;
  const rounds: [number, number][][] = [];
  const ring = Array.from({ length: m - 1 }, (_, i) => i + 1);
  for (let r = 0; r < m - 1; r++) {
    const circle = [0, ...ring];
    const pairs: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = circle[i];
      const b = circle[m - 1 - i];
      if (a < n && b < n) pairs.push([a, b]);
    }
    rounds.push(pairs);
    ring.unshift(ring.pop()!);
  }
  return rounds;
}

export interface PlayerStanding {
  seed: number;
  name: string;
  athleteId: string | null;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  place: number;
}

/** Compute standings sorted by wins → head-to-head → point diff → name. */
export function computeStandings(
  players: TournamentPlayer[],
  matches: TournamentMatch[],
): PlayerStanding[] {
  const sortedPlayers = [...players].sort((a, b) => a.seed - b.seed);
  const byKey = new Map<string, { a: number; b: number }>();
  for (const m of matches) {
    byKey.set(matchKey(m.player_a_seed, m.player_b_seed), { a: m.score_a, b: m.score_b });
  }
  const getScore = (i: number, j: number) => {
    const v = byKey.get(matchKey(i, j));
    if (!v) return null;
    return i < j ? { a: v.a, b: v.b } : { a: v.b, b: v.a };
  };
  const winner = (i: number, j: number) => {
    const s = getScore(i, j);
    if (!s || s.a === s.b) return null;
    return s.a > s.b ? i : j;
  };

  const rows: PlayerStanding[] = sortedPlayers.map((p) => {
    let played = 0;
    let wins = 0;
    let losses = 0;
    let pointsFor = 0;
    let pointsAgainst = 0;
    for (const q of sortedPlayers) {
      if (p.seed === q.seed) continue;
      const s = getScore(p.seed, q.seed);
      if (!s) continue;
      played++;
      pointsFor += s.a;
      pointsAgainst += s.b;
      if (s.a > s.b) wins++;
      else losses++;
    }
    return {
      seed: p.seed,
      name: p.display_name,
      athleteId: p.athlete_id,
      played,
      wins,
      losses,
      pointsFor,
      pointsAgainst,
      diff: pointsFor - pointsAgainst,
      place: 0,
    };
  });

  const ranked = [...rows].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const w = winner(a.seed, b.seed);
    if (w !== null) return w === a.seed ? -1 : 1;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.name.localeCompare(b.name, "ru");
  });
  ranked.forEach((r, idx) => {
    r.place = idx + 1;
  });
  return ranked;
}

export interface AthleteMatchRow {
  tournamentId: string;
  tournamentTitle: string;
  playedOn: string;
  opponentName: string;
  opponentAthleteId: string | null;
  myScore: number;
  oppScore: number;
  won: boolean;
}

export interface AthleteTournamentSummary {
  tournamentsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  bestPlace: number | null;
  placements: { tournamentId: string; title: string; playedOn: string; place: number; total: number; wins: number; played: number }[];
  matches: AthleteMatchRow[];
}

/** Aggregate an athlete's tournament career & match list across all tournaments. */
export function summarizeAthleteTournaments(
  athleteId: string,
  tournaments: Tournament[],
  players: TournamentPlayer[],
  matches: TournamentMatch[],
): AthleteTournamentSummary {
  const mySlots = players.filter((p) => p.athlete_id === athleteId);
  const tById = new Map(tournaments.map((t) => [t.id, t]));
  const placements: AthleteTournamentSummary["placements"] = [];
  const matchRows: AthleteMatchRow[] = [];

  for (const slot of mySlots) {
    const t = tById.get(slot.tournament_id);
    if (!t) continue;
    const tPlayers = players.filter((p) => p.tournament_id === t.id);
    const tMatches = matches.filter((m) => m.tournament_id === t.id);
    const standings = computeStandings(tPlayers, tMatches);
    const me = standings.find((s) => s.seed === slot.seed);
    if (me && me.played > 0) {
      placements.push({
        tournamentId: t.id,
        title: t.title,
        playedOn: t.played_on,
        place: me.place,
        total: tPlayers.length,
        wins: me.wins,
        played: me.played,
      });
    }
    const pBySeed = new Map(tPlayers.map((p) => [p.seed, p]));
    for (const m of tMatches) {
      if (m.player_a_seed !== slot.seed && m.player_b_seed !== slot.seed) continue;
      const isA = m.player_a_seed === slot.seed;
      const oppSeed = isA ? m.player_b_seed : m.player_a_seed;
      const opp = pBySeed.get(oppSeed);
      const myScore = isA ? m.score_a : m.score_b;
      const oppScore = isA ? m.score_b : m.score_a;
      matchRows.push({
        tournamentId: t.id,
        tournamentTitle: t.title,
        playedOn: t.played_on,
        opponentName: opp?.display_name ?? `#${oppSeed + 1}`,
        opponentAthleteId: opp?.athlete_id ?? null,
        myScore,
        oppScore,
        won: myScore > oppScore,
      });
    }
  }

  placements.sort((a, b) => b.playedOn.localeCompare(a.playedOn));
  matchRows.sort((a, b) => b.playedOn.localeCompare(a.playedOn));

  const wins = matchRows.filter((m) => m.won).length;
  const losses = matchRows.length - wins;
  const pointsFor = matchRows.reduce((a, m) => a + m.myScore, 0);
  const pointsAgainst = matchRows.reduce((a, m) => a + m.oppScore, 0);
  const bestPlace = placements.length ? Math.min(...placements.map((p) => p.place)) : null;

  return {
    tournamentsPlayed: placements.length,
    matchesPlayed: matchRows.length,
    wins,
    losses,
    winRate: matchRows.length ? Math.round((wins / matchRows.length) * 100) : null,
    pointsFor,
    pointsAgainst,
    diff: pointsFor - pointsAgainst,
    bestPlace,
    placements,
    matches: matchRows,
  };
}
