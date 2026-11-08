import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { todayInTz } from "@/lib/dates";
import { TournamentCreateForm } from "./create-form";
import type {
  Athlete,
  Profile,
  Tournament,
  TournamentMatch,
  TournamentPlayer,
} from "@/lib/types";

/** Mini-tournaments list + create form (coach/admin). */
export default async function CoachTournamentsPage() {
  const me = await requireRole(["coach", "admin"]);
  const dict = getDictionary(me.preferred_language);
  const d = dict.tournaments;
  const supabase = await createClient();
  const today = todayInTz(me.timezone ?? "Europe/Chisinau");

  const [tRes, pRes, mRes, aRes, prRes] = await Promise.all([
    supabase.from("tournaments").select("*").order("played_on", { ascending: false }),
    supabase.from("tournament_players").select("tournament_id"),
    supabase.from("tournament_matches").select("tournament_id"),
    supabase.from("athletes").select("id, profile_id, athlete_code").eq("status", "active"),
    supabase.from("profiles").select("id, display_name"),
  ]);

  const tournaments = (tRes.data as Tournament[]) ?? [];
  const players = (pRes.data as Pick<TournamentPlayer, "tournament_id">[]) ?? [];
  const matches = (mRes.data as Pick<TournamentMatch, "tournament_id">[]) ?? [];
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

  const playersByT = new Map<string, number>();
  for (const p of players) playersByT.set(p.tournament_id, (playersByT.get(p.tournament_id) ?? 0) + 1);
  const matchesByT = new Map<string, number>();
  for (const m of matches) matchesByT.set(m.tournament_id, (matchesByT.get(m.tournament_id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{d.title}</h1>
        <p className="text-sm text-muted">{d.subtitle}</p>
      </div>

      <details
        open={tournaments.length === 0}
        className="rounded-xl border border-border bg-surface"
      >
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
          {d.newBtn}
        </summary>
        <div className="border-t border-border px-4 py-3">
          <TournamentCreateForm d={d} athletes={athleteOpts} today={today} />
        </div>
      </details>

      {tournaments.length === 0 ? (
        <p className="text-sm text-muted">{d.empty}</p>
      ) : (
        <ul className="space-y-2">
          {tournaments.map((t) => {
            const n = playersByT.get(t.id) ?? 0;
            const done = matchesByT.get(t.id) ?? 0;
            const total = (n * (n - 1)) / 2;
            const finished = total > 0 && done === total;
            return (
              <li key={t.id}>
                <Link
                  href={`/coach/tournaments/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/50"
                >
                  <div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-xs text-muted">
                      {t.played_on} · {n} {d.playersCount} · {done}/{total} {d.matchesOf}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      finished ? "bg-ok/15 text-ok" : "bg-accent/10 text-accent"
                    }`}
                  >
                    {finished ? d.statusDone : d.statusActive}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
