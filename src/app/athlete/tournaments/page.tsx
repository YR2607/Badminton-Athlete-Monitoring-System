import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { summarizeAthleteTournaments } from "@/lib/tournaments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tournament, TournamentMatch, TournamentPlayer } from "@/lib/types";

/** Athlete's tournament history: career stats, placements, match list. */
export default async function AthleteTournamentsPage() {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));
  const dict = getDictionary(profile.preferred_language);
  const d = dict.tournaments;
  const dr = dict.report;
  const supabase = await createClient();

  // Tournaments where this athlete has a slot.
  const { data: mySlots } = await supabase
    .from("tournament_players")
    .select("tournament_id")
    .eq("athlete_id", athlete.id);
  const tIds = [...new Set(((mySlots as { tournament_id: string }[]) ?? []).map((s) => s.tournament_id))];

  let tournaments: Tournament[] = [];
  let players: TournamentPlayer[] = [];
  let matches: TournamentMatch[] = [];
  if (tIds.length > 0) {
    const [tRes, pRes, mRes] = await Promise.all([
      supabase.from("tournaments").select("*").in("id", tIds).order("played_on", { ascending: false }),
      supabase.from("tournament_players").select("*").in("tournament_id", tIds),
      supabase.from("tournament_matches").select("*").in("tournament_id", tIds),
    ]);
    tournaments = (tRes.data as Tournament[]) ?? [];
    players = (pRes.data as TournamentPlayer[]) ?? [];
    matches = (mRes.data as TournamentMatch[]) ?? [];
  }

  const sum = summarizeAthleteTournaments(athlete.id, tournaments, players, matches);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{d.myTournaments}</h1>

      {sum.matchesPlayed === 0 ? (
        <p className="text-sm text-muted">{d.noTournaments}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[
              { l: dr.tournamentsPlayed, v: String(sum.tournamentsPlayed) },
              { l: dr.matchesRecord, v: `${sum.wins}-${sum.losses}` },
              { l: dr.winRate, v: sum.winRate !== null ? `${sum.winRate}%` : "—" },
              { l: dr.pointsDiff, v: sum.diff > 0 ? `+${sum.diff}` : String(sum.diff) },
              { l: dr.bestPlace, v: sum.bestPlace !== null ? `#${sum.bestPlace}` : "—" },
            ].map(({ l, v }) => (
              <div key={l} className="rounded-xl border border-border bg-surface p-3">
                <div className="text-xl font-bold tabular-nums">{v}</div>
                <div className="text-xs text-muted">{l}</div>
              </div>
            ))}
          </div>

          {sum.placements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{dr.tournamentsTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {sum.placements.map((p) => (
                    <li key={p.tournamentId} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/athlete/tournaments/${p.tournamentId}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {p.title}
                        </Link>
                        <div className="text-xs text-muted">
                          {p.playedOn} · {d.winsOf.replace("{wins}", String(p.wins)).replace("{played}", String(p.played))}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                        {d.placeOf.replace("{place}", String(p.place)).replace("{total}", String(p.total))}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{d.allMatches}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {sum.matches.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className="font-medium">{m.opponentName}</span>
                      <div className="text-xs text-muted">
                        {m.playedOn} · {m.tournamentTitle}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 font-bold tabular-nums ${
                        m.won ? "text-ok" : "text-danger"
                      }`}
                    >
                      {m.myScore}:{m.oppScore} {m.won ? d.won : d.lost}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
