"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseScoreInput } from "@/lib/tournaments";

export async function createTournamentAction(input: {
  title: string;
  playedOn: string;
  courts: number;
  participants: { displayName: string; athleteId: string | null }[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireRole(["coach", "admin"]);
  const clean = input.participants
    .map((p) => ({ displayName: p.displayName.trim(), athleteId: p.athleteId || null }))
    .filter((p) => p.displayName.length > 0);
  if (clean.length < 2) {
    return { ok: false, error: "min_players" };
  }
  const supabase = await createClient();
  const { data: t, error: tErr } = await supabase
    .from("tournaments")
    .insert({
      title: input.title.trim() || "Мини-турнир",
      played_on: input.playedOn,
      courts: Math.max(1, Math.min(12, input.courts || 4)),
      created_by: me.id,
    })
    .select("id")
    .single();
  if (tErr || !t) return { ok: false, error: tErr?.message ?? "create_failed" };

  const playerRows = clean.map((p, idx) => ({
    tournament_id: t.id,
    seed: idx,
    display_name: p.displayName,
    athlete_id: p.athleteId,
  }));
  const { error: pErr } = await supabase.from("tournament_players").insert(playerRows);
  if (pErr) return { ok: false, error: pErr.message };

  revalidatePath("/coach/tournaments");
  revalidatePath("/athlete/tournaments");
  return { ok: true, id: t.id as string };
}

export async function saveMatchScoreAction(input: {
  tournamentId: string;
  seedA: number;
  seedB: number;
  rawScore: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole(["coach", "admin"]);
  const supabase = await createClient();
  const i = Math.min(input.seedA, input.seedB);
  const j = Math.max(input.seedA, input.seedB);

  const trimmed = input.rawScore.trim();
  if (!trimmed) {
    await supabase
      .from("tournament_matches")
      .delete()
      .eq("tournament_id", input.tournamentId)
      .eq("player_a_seed", i)
      .eq("player_b_seed", j);
  } else {
    const parsed = parseScoreInput(trimmed);
    if (!parsed) return { ok: false, error: "bad_score" };
    const scoreA = input.seedA < input.seedB ? parsed.x : parsed.y;
    const scoreB = input.seedA < input.seedB ? parsed.y : parsed.x;
    const { error } = await supabase.from("tournament_matches").upsert(
      {
        tournament_id: input.tournamentId,
        player_a_seed: i,
        player_b_seed: j,
        score_a: scoreA,
        score_b: scoreB,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tournament_id,player_a_seed,player_b_seed" },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/coach/tournaments/${input.tournamentId}`);
  revalidatePath("/coach/tournaments");
  revalidatePath("/athlete/tournaments");
  return { ok: true };
}

export async function linkPlayerAthleteAction(input: {
  playerId: string;
  tournamentId: string;
  athleteId: string | null;
}): Promise<{ ok: boolean }> {
  await requireRole(["coach", "admin"]);
  const supabase = await createClient();
  await supabase
    .from("tournament_players")
    .update({ athlete_id: input.athleteId || null })
    .eq("id", input.playerId);
  revalidatePath(`/coach/tournaments/${input.tournamentId}`);
  revalidatePath("/athlete/tournaments");
  return { ok: true };
}

export async function importTournamentJsonAction(input: {
  tournamentId: string;
  results: Record<string, { a: number; b: number }>;
}): Promise<{ ok: boolean; count: number }> {
  await requireRole(["coach", "admin"]);
  const supabase = await createClient();
  const rows: {
    tournament_id: string;
    player_a_seed: number;
    player_b_seed: number;
    score_a: number;
    score_b: number;
  }[] = [];
  for (const [key, val] of Object.entries(input.results)) {
    const [sa, sb] = key.split("-").map(Number);
    const a = Number(val?.a);
    const b = Number(val?.b);
    if (
      Number.isInteger(sa) &&
      Number.isInteger(sb) &&
      sa < sb &&
      Number.isInteger(a) &&
      Number.isInteger(b) &&
      a !== b &&
      a >= 0 &&
      b >= 0 &&
      a <= 99 &&
      b <= 99
    ) {
      rows.push({
        tournament_id: input.tournamentId,
        player_a_seed: sa,
        player_b_seed: sb,
        score_a: a,
        score_b: b,
      });
    }
  }
  if (rows.length > 0) {
    await supabase
      .from("tournament_matches")
      .upsert(rows, { onConflict: "tournament_id,player_a_seed,player_b_seed" });
  }
  revalidatePath(`/coach/tournaments/${input.tournamentId}`);
  revalidatePath("/athlete/tournaments");
  return { ok: true, count: rows.length };
}

export async function deleteTournamentAction(tournamentId: string): Promise<{ ok: boolean }> {
  await requireRole(["coach", "admin"]);
  const supabase = await createClient();
  await supabase.from("tournaments").delete().eq("id", tournamentId);
  revalidatePath("/coach/tournaments");
  revalidatePath("/athlete/tournaments");
  return { ok: true };
}
