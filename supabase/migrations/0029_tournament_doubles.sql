-- Doubles and mixed-doubles tournaments: a bracket slot can hold a pair.
-- format distinguishes singles/doubles/mixed; partner_athlete_id links the
-- second club athlete so match history counts for both players.

alter table public.tournaments
  add column if not exists format text not null default 'singles'
    check (format in ('singles', 'doubles', 'mixed'));

alter table public.tournament_players
  add column if not exists partner_athlete_id uuid references public.athletes (id) on delete set null;

create index if not exists tournament_players_partner_idx
  on public.tournament_players (partner_athlete_id);
