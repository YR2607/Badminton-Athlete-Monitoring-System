-- Round-robin mini-tournaments: matrix, Berger rounds, live standings and
-- per-athlete match history synced across admin/coach and athlete views.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  played_on date not null default current_date,
  courts smallint not null default 4 check (courts between 1 and 12),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  seed smallint not null check (seed >= 0),
  display_name text not null,
  athlete_id uuid references public.athletes (id) on delete set null,
  unique (tournament_id, seed)
);
create index if not exists tournament_players_athlete_idx on public.tournament_players (athlete_id);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_a_seed smallint not null,
  player_b_seed smallint not null,
  score_a smallint not null check (score_a between 0 and 99),
  score_b smallint not null check (score_b between 0 and 99),
  updated_at timestamptz not null default now(),
  check (player_a_seed < player_b_seed),
  check (score_a <> score_b),
  unique (tournament_id, player_a_seed, player_b_seed)
);
create index if not exists tournament_matches_tid_idx on public.tournament_matches (tournament_id);

alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.tournament_matches enable row level security;

-- Everyone authenticated in the club can view tournaments, matrix and standings.
create policy tournaments_select on public.tournaments
  for select to authenticated using (true);
create policy tournament_players_select on public.tournament_players
  for select to authenticated using (true);
create policy tournament_matches_select on public.tournament_matches
  for select to authenticated using (true);

-- Coaches and admins create/update/delete tournaments, players and match scores.
create policy tournaments_staff_all on public.tournaments
  for all to authenticated
  using (public.is_admin() or public.current_role() = 'coach')
  with check (public.is_admin() or public.current_role() = 'coach');

create policy tournament_players_staff_all on public.tournament_players
  for all to authenticated
  using (public.is_admin() or public.current_role() = 'coach')
  with check (public.is_admin() or public.current_role() = 'coach');

create policy tournament_matches_staff_all on public.tournament_matches
  for all to authenticated
  using (public.is_admin() or public.current_role() = 'coach')
  with check (public.is_admin() or public.current_role() = 'coach');
