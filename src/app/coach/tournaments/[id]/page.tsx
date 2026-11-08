import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { TournamentMatrixView } from "@/components/tournament-matrix";
import type {
  Athlete,
  Profile,
  Tournament,
  TournamentMatch,
  TournamentPlayer,
} from "@/lib/types";

/** Single tournament: editable matrix, rounds/courts, standings, athlete links. */
export default async function CoachTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const d = dict.tournaments;
  const supabase = await createClient();

  const [tRes, pRes, mRes, aRes, prRes] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", id).maybeSingle(),
    supabase.from("tournament_players").select("*").eq("tournament_id", id).order("seed"),
    supabase.from("tournament_matches").select("*").eq("tournament_id", id),
    supabase.from("athletes").select("id, profile_id, athlete_code").eq("status", "active"),
    supabase.from("profiles").select("id, display_name"),
  ]);

  const tournament = tRes.data as Tournament | null;
  if (!tournament) notFound();
  const players = (pRes.data as TournamentPlayer[]) ?? [];
  const matches = (mRes.data as TournamentMatch[]) ?? [];
  const nameByProfile = new Map(
    ((prRes.data as Pick<Profile, "id" | "display_name">[]) ?? []).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  const athleteOpts = (
    (aRes.data as Pick<Athlete, "id" | "profile_id" | "athlete_code">[]) ?? []
  )
    .map((a) => ({ id: a.id, name: nameByProfile.get(a.profile_id) ?? a.athlete_code }))
    .sort((x, y) => x.name.localeCompare(y.name));

  return (
    <div className="space-y-3">
      <Link href="/coach/tournaments" className="text-sm text-accent">
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
        athletes={athleteOpts}
        editable
      />
    </div>
  );
}
