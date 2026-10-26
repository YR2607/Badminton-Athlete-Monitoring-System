-- 0021: Badminton-specific extensions (racket hand, session focus tags, tournament match fields).

alter table public.athletes
  add column if not exists racket_hand text check (racket_hand in ('right', 'left')) default 'right';

alter table public.training_sessions
  add column if not exists focus_tags text[] not null default '{}',
  add column if not exists match_discipline text check (match_discipline in ('MS', 'WS', 'MD', 'WD', 'XD')),
  add column if not exists match_result text check (match_result in ('win', 'loss'));
