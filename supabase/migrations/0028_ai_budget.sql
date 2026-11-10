-- AI cost protection: atomic monthly budget + distributed rate counters.
-- Atomicity via single-row UPDATE under row lock — concurrent callers
-- serialize on the row; only requests inside the cap succeed.

create table if not exists public.ai_budget_months (
  month date primary key,
  reserved_usd numeric not null default 0,
  spent_usd numeric not null default 0
);

create table if not exists public.ai_rate_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

alter table public.ai_budget_months enable row level security;
alter table public.ai_rate_counters enable row level security;

-- Financial data: admins only. Counters are touched via security-definer fns.
create policy ai_budget_admin on public.ai_budget_months
  for select to authenticated using (public.is_admin());
create policy ai_rate_admin on public.ai_rate_counters
  for select to authenticated using (public.is_admin());

-- Atomic reservation: returns true iff est fits inside the monthly cap.
create or replace function public.ai_reserve_budget(p_est_usd numeric, p_cap_usd numeric)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ai_budget_months (month, reserved_usd, spent_usd)
  values (date_trunc('month', current_date)::date, 0, 0)
  on conflict (month) do nothing;
  update public.ai_budget_months
     set reserved_usd = reserved_usd + p_est_usd
   where month = date_trunc('month', current_date)::date
     and reserved_usd + spent_usd + p_est_usd <= p_cap_usd;
  return found;
end;
$$;

-- Settle: release the reservation, add actual cost (0 on failed generation).
create or replace function public.ai_settle_budget(p_reserved_usd numeric, p_actual_usd numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.ai_budget_months
     set reserved_usd = greatest(reserved_usd - p_reserved_usd, 0),
         spent_usd = spent_usd + p_actual_usd
   where month = date_trunc('month', current_date)::date;
end;
$$;

-- Distributed fixed-window rate limit: atomic increment under row lock.
create or replace function public.ai_rate_check(p_key text, p_max integer, p_window_sec integer default 3600)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ai_rate_counters (key, window_start, count)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec), 0)
  on conflict (key, window_start) do nothing;
  update public.ai_rate_counters
     set count = count + 1
   where key = p_key
     and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec)
     and count < p_max;
  return found;
end;
$$;
