-- 0017: monthly field tests (Phase 6, flag 'field_tests').
-- field_tests is the admin-managed dictionary; field_test_results stores
-- every attempt (the best value per day is derived, not duplicated).

create table public.field_tests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name jsonb not null,              -- {ru, en, ro}
  unit text not null,               -- 'cm' | 's' | 'level' | 'reps' | ...
  higher_better boolean not null default true,
  instruction jsonb not null default '{}'::jsonb,  -- {ru, en, ro}
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.field_test_results (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  test_id uuid not null references public.field_tests(id) on delete cascade,
  test_date date not null,
  value numeric not null,
  attempt int not null default 1 check (attempt between 1 and 9),
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (athlete_id, test_id, test_date, attempt)
);

create index field_test_results_athlete_idx
  on public.field_test_results (athlete_id, test_id, test_date);

alter table public.field_tests enable row level security;
alter table public.field_test_results enable row level security;

-- Dictionary is readable by every signed-in user; only admin writes.
create policy field_tests_select on public.field_tests for select using (true);
create policy field_tests_write on public.field_tests for all using (public.is_admin());

create policy ft_results_select on public.field_test_results
  for select using (
    athlete_id = public.current_athlete_id()
    or public.can_access_athlete(athlete_id)
    or public.is_admin()
  );
create policy ft_results_insert on public.field_test_results
  for insert with check (public.can_access_athlete(athlete_id) or public.is_admin());
create policy ft_results_delete on public.field_test_results
  for delete using (public.can_access_athlete(athlete_id) or public.is_admin());

insert into public.field_tests (code, name, unit, higher_better, instruction, sort_order) values
  (
    'standing_long_jump',
    '{"ru":"Прыжок в длину с места","en":"Standing long jump","ro":"Săritură în lungime de pe loc"}',
    'cm', true,
    '{"ru":"С места, без разбега, двумя ногами. Замеряется по ближайшей точке касания. Лучшая из 3 попыток.","en":"From standing, both feet. Measure to the nearest landing point. Best of 3 attempts.","ro":"De pe loc, cu ambele picioare. Se măsoară până la cel mai apropiat punct de aterizare. Cea mai bună din 3 încercări."}',
    10
  ),
  (
    'cmj',
    '{"ru":"Прыжок вверх CMJ","en":"Countermovement jump (CMJ)","ro":"Săritură verticală CMJ"}',
    'cm', true,
    '{"ru":"По замедленной съёмке телефона: засеките время полёта t (сек, между отрывом и касанием) и посчитайте высоту h = 9.81·t²/8 · 100 см. Руки на поясе.","en":"From slow-motion phone video: measure flight time t (s, take-off to landing), height h = 9.81·t²/8 · 100 cm. Hands on hips.","ro":"Din video slow-motion: măsurați timpul de zbor t (s, de la decolare la aterizare), înălțimea h = 9.81·t²/8 · 100 cm. Mâinile pe șold."}',
    20
  ),
  (
    'four_corners',
    '{"ru":"Челнок «4 угла»","en":"4-corners court shuttle","ro":"Naveta «4 colțuri»"}',
    's', false,
    '{"ru":"Стандартный бадминтонный челнок по 4 углам корта. Засекается полное время. Меньше — лучше.","en":"Standard badminton 4-corner court shuttle. Total time, lower is better.","ro":"Naveta standard de badminton pe 4 colțuri. Timp total, mai mic = mai bine."}',
    30
  ),
  (
    'sit_and_reach',
    '{"ru":"Наклон сидя","en":"Sit and reach","ro":"Îndoire din șezut"}',
    'cm', true,
    '{"ru":"Сидя, ноги прямые, тянуться вперёд. Замер в см от линии стоп (0 у стоп, + вперёд, − назад).","en":"Seated, legs straight, reach forward. cm from the toes line (0 at toes, + beyond, − behind).","ro":"Șezând, picioarele întinse, aplecare în față. cm față de linia degetelor (0 la degete, + dincolo, − înainte)."}',
    40
  ),
  (
    'beep_test',
    '{"ru":"Бег с нарастающей скоростью","en":"Yo-Yo / beep test","ro":"Test de anduranță progresiv"}',
    'level', true,
    '{"ru":"Челноки 20 м под аудиосигналы с ускорением. Записывается достигнутый уровень.","en":"20 m shuttles to accelerating audio signals. Record the reached level.","ro":"Navete de 20 m după semnale audio accelerate. Se înregistrează nivelul atins."}',
    50
  );
