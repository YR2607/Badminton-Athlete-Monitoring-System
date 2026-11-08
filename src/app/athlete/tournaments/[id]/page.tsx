import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAthlete, getCurrentProfile, homeForRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { TournamentMatrixView } from "@/components/tournament-matrix";
import type { Tournament, TournamentMatch, TournamentPlayer } from "@/lib/types";

/** Read-only tournament view for the athlete, with their matches highlighted. */
export default async function AthleteTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = (await getCurrentProfile())!;
  const athlete = await getCurrentAthlete();
  if (!athlete) redirect(homeForRole(profile.role));
  const dict = getDictionary(profile.preferred_language);
  const d = dict.tournaments;
  const { id } = await params;
  const supabase = await createClient();

  const [tRes, pRes, mRes] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", id).maybeSingle(),
    supabase.from("tournament_players").select("*").eq("tournament_id", id).order("seed"),
    supabase.from("tournament_matches").select("*").eq("tournament_id", id),
  ]);

  const tournament = tRes.data as Tournament | null;
  if (!tournament) notFound();
  const players = (pRes.data as TournamentPlayer[]) ?? [];
  const matches = (mRes.data as TournamentMatch[]) ?? [];

  return (
    <div className="space-y-3">
      <Link href="/athlete/tournaments" className="text-sm text-accent">
        ← {d.back}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{tournament.title}</h1>
        <p className="text-sm text-muted">{tournament.played_on}</p>
      </div>
      <TournamentMatrixView
        tournament={tournament}
        players={players}
        matches={matches}
        d={d}
        myAthleteId={athlete.id}
      />
    </div>
  );
}
