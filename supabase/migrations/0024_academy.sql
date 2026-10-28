-- 0024_academy.sql
-- RallyMonitor Academy: daily badminton micro-lessons, 10 curriculum topics,
-- 10 content types (including SVG court visual tactics), monthly tests,
-- athlete progress & RLS.

-- 1. Individual learning level on athletes (independent of age).
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS academy_level text NOT NULL DEFAULT 'beginner'
    CHECK (academy_level IN ('beginner', 'intermediate', 'advanced'));

-- 2. Feature flag ('academy' enabled by default for all groups).
INSERT INTO public.feature_flags (key, enabled, group_ids, description)
VALUES (
  'academy',
  true,
  '{}',
  'RallyMonitor Academy — daily badminton tasks, tactics, rules & monthly tests'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Academy content library (10 types × 10 topics, localized in {ru, en, ro}).
CREATE TABLE IF NOT EXISTS public.academy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  item_type text NOT NULL CHECK (
    item_type IN (
      'fact',
      'single_choice',
      'multi_choice',
      'tactical',
      'find_mistake',
      'rules',
      'technique',
      'physical_recovery',
      'psychology',
      'visual_tactical'
    )
  ),
  topic text NOT NULL CHECK (
    topic IN (
      'rules',
      'technique',
      'singles_tactics',
      'doubles_tactics',
      'game_iq',
      'footwork',
      'conditioning',
      'recovery_prevention',
      'psychology',
      'history_facts'
    )
  ),
  difficulty text NOT NULL DEFAULT 'beginner' CHECK (
    difficulty IN ('beginner', 'intermediate', 'advanced')
  ),
  min_age smallint NOT NULL DEFAULT 10 CHECK (min_age BETWEEN 6 AND 25),
  max_age smallint NOT NULL DEFAULT 17 CHECK (max_age BETWEEN 6 AND 25),
  title jsonb NOT NULL,                -- {ru, en, ro}
  body jsonb NOT NULL,                 -- {ru, en, ro}
  options jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id, text: {ru, en, ro}}]
  correct_option_ids text[] NOT NULL DEFAULT '{}',
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb, -- {ru, en, ro}
  source_ref text,
  court_diagram jsonb,                 -- optional SVG court players/shuttle/arrows
  scheduled_date date,
  target_group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_items_sched
  ON public.academy_items (published, scheduled_date, topic, difficulty);

-- 4. Athlete responses to daily/practice items (idempotent via UNIQUE(athlete_id, item_id)).
CREATE TABLE IF NOT EXISTS public.academy_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.academy_items(id) ON DELETE CASCADE,
  assigned_date date NOT NULL,
  selected_option_ids text[] NOT NULL DEFAULT '{}',
  is_correct boolean NOT NULL,
  points_awarded smallint NOT NULL DEFAULT 0 CHECK (points_awarded BETWEEN 0 AND 100),
  duration_sec int NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_responses_athlete
  ON public.academy_responses (athlete_id, assigned_date DESC);

-- 5. Monthly tests.
CREATE TABLE IF NOT EXISTS public.academy_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title jsonb NOT NULL,                -- {ru, en, ro}
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  topics text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'beginner' CHECK (
    difficulty IN ('beginner', 'intermediate', 'advanced')
  ),
  question_ids uuid[] NOT NULL DEFAULT '{}',
  question_count smallint NOT NULL DEFAULT 10 CHECK (question_count BETWEEN 1 AND 50),
  time_limit_minutes smallint CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 120),
  target_group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  target_athlete_ids uuid[] NOT NULL DEFAULT '{}',
  available_from date NOT NULL,
  available_until date NOT NULL,
  max_attempts smallint NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 5),
  published boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Monthly test attempts (supports in_progress draft saving, expiry & retries).
CREATE TABLE IF NOT EXISTS public.academy_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.academy_tests(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  attempt_number smallint NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 10),
  question_order uuid[] NOT NULL DEFAULT '{}',
  draft_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_pct smallint CHECK (score_pct IS NULL OR score_pct BETWEEN 0 AND 100),
  correct_count smallint NOT NULL DEFAULT 0,
  total_count smallint NOT NULL DEFAULT 0,
  topic_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'in_progress' CHECK (
    status IN ('in_progress', 'submitted', 'expired')
  ),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE (test_id, athlete_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_academy_test_attempts_athlete
  ON public.academy_test_attempts (athlete_id, test_id);

-- 7. Row-Level Security
ALTER TABLE public.academy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_test_attempts ENABLE ROW LEVEL SECURITY;

-- IMPORTANT: Direct table SELECT on academy_items is restricted to coaches/admins
-- so athletes can never query `correct_option_ids` or `explanation` directly from
-- the browser before completing a task or test. Server components/actions serve
-- redacted items to athletes.
DROP POLICY IF EXISTS academy_items_coach_all ON public.academy_items;
CREATE POLICY academy_items_coach_all ON public.academy_items
  FOR ALL
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

-- Responses: athlete sees & inserts only own; coaches see accessible athletes.
DROP POLICY IF EXISTS academy_responses_select ON public.academy_responses;
CREATE POLICY academy_responses_select ON public.academy_responses
  FOR SELECT USING (
    athlete_id = public.current_athlete_id()
    OR public.can_access_athlete(athlete_id)
    OR public.is_admin()
  );

DROP POLICY IF EXISTS academy_responses_insert ON public.academy_responses;
CREATE POLICY academy_responses_insert ON public.academy_responses
  FOR INSERT WITH CHECK (
    athlete_id = public.current_athlete_id()
    OR public.is_admin()
  );

-- Tests metadata: coaches manage all; athletes see published tests targeted to them/their group.
DROP POLICY IF EXISTS academy_tests_coach_all ON public.academy_tests;
CREATE POLICY academy_tests_coach_all ON public.academy_tests
  FOR ALL
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

DROP POLICY IF EXISTS academy_tests_athlete_select ON public.academy_tests;
CREATE POLICY academy_tests_athlete_select ON public.academy_tests
  FOR SELECT USING (
    published = true
    AND public.current_athlete_id() IS NOT NULL
  );

-- Test attempts: athlete sees/updates own; coaches see accessible athletes.
DROP POLICY IF EXISTS academy_attempts_select ON public.academy_test_attempts;
CREATE POLICY academy_attempts_select ON public.academy_test_attempts
  FOR SELECT USING (
    athlete_id = public.current_athlete_id()
    OR public.can_access_athlete(athlete_id)
    OR public.is_admin()
  );

DROP POLICY IF EXISTS academy_attempts_insert ON public.academy_test_attempts;
CREATE POLICY academy_attempts_insert ON public.academy_test_attempts
  FOR INSERT WITH CHECK (
    athlete_id = public.current_athlete_id()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS academy_attempts_update ON public.academy_test_attempts;
CREATE POLICY academy_attempts_update ON public.academy_test_attempts
  FOR UPDATE USING (
    athlete_id = public.current_athlete_id()
    OR public.is_admin()
  );

-- 8. Seed verified badminton items covering all 10 content types & all 10 topics.
INSERT INTO public.academy_items (
  code, item_type, topic, difficulty, min_age, max_age,
  title, body, options, correct_option_ids, explanation, source_ref, court_diagram, published
) VALUES
  (
    'fact_feathers_16',
    'fact',
    'history_facts',
    'beginner',
    10, 17,
    '{"ru":"16 перьев в турнирном волане","en":"16 feathers in a tournament shuttlecock","ro":"16 pene într-un fluturaș de turneu"}',
    '{"ru":"По правилам BWF перьевой волан всегда состоит ровно из 16 перьев одинаковой длины (от 62 до 70 мм) и весит от 4,74 до 5,50 грамма. Для турниров обычно берут перья с левого крыла гуся — благодаря одинаковому изгибу волан стабильно вращается против часовой стрелки.","en":"Under BWF Laws, a feathered shuttlecock always has exactly 16 feathers of uniform length (62–70 mm) and weighs 4.74 to 5.50 grams. Tournament shuttles use feathers from the same wing so the shuttle spins consistently in flight.","ro":"Conform regulamentului BWF, un fluturaș cu pene are exact 16 pene de lungime egală (62–70 mm) și cântărește între 4,74 și 5,50 grame, asigurând o rotație stabilă în zbor."}',
    '[{"id":"ack","text":{"ru":"Понятно, запомнил!","en":"Got it!","ro":"Am înțeles!"}}]'::jsonb,
    ARRAY['ack'],
    '{"ru":"Вес 4,74–5,50 г и 16 перьев закреплены в Правиле 2 BWF. Чем теплее зал, тем быстрее летит волан, поэтому судьи перед матчем тестируют скорость волана ударом снизу с задней линии.","en":"16 feathers and 4.74–5.50 g are specified in BWF Law 2. Warmer halls make the shuttle fly faster, which is why players test shuttle speed before the match.","ro":"Cele 16 pene și greutatea de 4,74–5,50 g sunt prevăzute în Regula 2 BWF."}',
    'BWF Laws of Badminton §2.2',
    NULL,
    true
  ),
  (
    'rules_service_height_115',
    'rules',
    'rules',
    'beginner',
    10, 17,
    '{"ru":"Максимальная высота подачи в BWF","en":"Maximum service height under BWF rules","ro":"Înălțimea maximă a serviciului în BWF"}',
    '{"ru":"На какой максимальной высоте от поверхности корта должен находиться весь волан в момент удара ракеткой при подаче по современным правилам BWF?","en":"At what maximum height above the court surface must the whole shuttle be at the instant of being hit by the server''s racket under current BWF rules?","ro":"La ce înălțime maximă deasupra suprafeței terenului trebuie să se afle întregul fluturaș în momentul lovirii la serviciu conform regulilor BWF?"}',
    '[
      {"id":"a","text":{"ru":"Не выше 1,15 метра от поверхности корта","en":"No higher than 1.15 metres from the court surface","ro":"Nu mai sus de 1,15 metri de la suprafața terenului"}},
      {"id":"b","text":{"ru":"Ниже нижнего ребра подающего, без фиксированной высоты","en":"Below the server''s lowest rib, no fixed height","ro":"Sub ultima coastă a jucătorului, fără înălțime fixă"}},
      {"id":"c","text":{"ru":"Не выше 1,30 метра от корта","en":"No higher than 1.30 metres","ro":"Nu mai sus de 1,30 metri"}},
      {"id":"d","text":{"ru":"Не выше верхнего края сетки (1,55 м)","en":"No higher than the net tape (1.55 m)","ro":"Nu mai sus de banda fileului (1,55 m)"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"По правилу BWF §9.1.6 весь волан в момент удара при подаче должен находиться на высоте не более 1,15 м от поверхности корта (фиксированное правило заменило старое правило «ниже талии»).","en":"BWF Law 9.1.6 states that the whole shuttle shall be below 1.15 metres from the surface of the court at the instant of being hit by the server''s racket.","ro":"Conform Regulii BWF §9.1.6, întregul fluturaș trebuie să fie sub 1,15 m de la suprafața terenului în momentul impactului."}',
    'BWF Laws of Badminton §9.1.6',
    NULL,
    true
  ),
  (
    'single_deuce_cap_30',
    'single_choice',
    'rules',
    'beginner',
    10, 17,
    '{"ru":"Решающее очко при счёте 29:29","en":"Deciding point at 29–all","ro":"Punctul decisiv la scorul de 29–29"}',
    '{"ru":"В партии счёт дошёл до 29:29. Кто выигрывает эту партию по официальным правилам BWF (система 3×21)?","en":"The score in a game reaches 29–29. Who wins the game under official BWF 3×21 scoring rules?","ro":"Scorul într-un set ajunge la 29–29. Cine câștigă setul conform regulilor oficiale BWF (3×21)?"}',
    '[
      {"id":"a","text":{"ru":"Игрок, набравший 30-е очко (со счётом 30:29)","en":"The side scoring the 30th point (30–29)","ro":"Jucătorul care câștigă punctul 30 (30–29)"}},
      {"id":"b","text":{"ru":"Игра продолжается до разницы в 2 очка без потолка","en":"Play continues until a 2-point lead with no cap","ro":"Jocul continuă până la o diferență de 2 puncte fără limită"}},
      {"id":"c","text":{"ru":"Разыгрывается тай-брейк до 7 очков","en":"A 7-point tie-break is played","ro":"Se joacă un tie-break până la 7 puncte"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"По правилу BWF §7.3 при счёте 20:20 игра идёт до разницы в 2 очка, но при 29:29 партию выигрывает сторона, первой набравшая 30-е очко (30:29).","en":"Under BWF Law 7.3, at 20-all play continues until a 2-point lead, but at 29-all the side scoring the 30th point wins that game (30–29).","ro":"Conform Regulii BWF §7.3, la 29–29 câștigă setul cel care face punctul 30 (30–29)."}',
    'BWF Laws of Badminton §7.2–7.3',
    NULL,
    true
  ),
  (
    'multi_doubles_attack_rotation',
    'multi_choice',
    'doubles_tactics',
    'intermediate',
    11, 17,
    '{"ru":"Парная атака: что делает напарник при твоём прыжковом смэше с задней линии?","en":"Doubles attack: what should your partner do when you jump-smash from the rear court?","ro":"Atacul la dublu: ce face partenerul când execuți un jump-smash din spate?"}',
    '{"ru":"Ты выполняешь крутой смэш с задней линии в мужской/женской паре. Выбери ВСЕ верные действия твоего напарника в передней зоне («фронт-корте»):","en":"You hit a steep smash from the rear court in doubles. Select ALL correct actions for your front-court partner:","ro":"Execuți un smash abrupt din spatele terenului la dublu. Alege TOATE acțiunile corecte ale partenerului din față:"}',
    '[
      {"id":"a","text":{"ru":"Занять позицию у Т-зоны чуть сместившись в сторону направления твоего смэша","en":"Step into the T-zone, shading slightly toward the line of your smash","ro":"Se poziționează aproape de T, ușor pe direcția smash-ului tău"}},
      {"id":"b","text":{"ru":"Держать головку ракетки вверху перед собой для мгновенного добивания плоского ответа","en":"Keep the racket head up in front to intercept flat returns","ro":"Ține capul rachetei sus în față pentru a intercepta mingile plate"}},
      {"id":"c","text":{"ru":"Отойти назад в линию защиты «бок-о-бок», не дожидаясь ответа соперника","en":"Drop back into side-by-side defense before the opponent even hits","ro":"Se retrage imediat în apărare laterală înainte de răspunsul adversarului"}},
      {"id":"d","text":{"ru":"Опустить ракетку вниз к коленям и смотреть назад на тебя","en":"Drop the racket by the knees and turn around to watch you","ro":"Lasă racheta jos și se întoarce să se uite la tine"}}
    ]'::jsonb,
    ARRAY['a', 'b'],
    '{"ru":"В атакующем построении «впереди-сзади» сеточник перекрывает прямые и плоские ответы у Т-зоны с поднятой ракеткой. Оборачиваться назад опасно (и теряется время), а уходить в защиту нужно только если вместо смэша ты вынужден поднять свечу.","en":"In front-and-back attack, the net player shades toward the smash line with racket up to kill weak replies. Turning back is dangerous and loses reaction time.","ro":"În formația de atac față-spate, jucătorul de la fileu acoperă direcția smash-ului cu racheta sus pentru intercepție."}',
    'BWF Coach Education Level 1 — Doubles Tactics',
    NULL,
    true
  ),
  (
    'tactical_singles_late_forehand_rear',
    'tactical',
    'singles_tactics',
    'intermediate',
    11, 17,
    '{"ru":"Одиночка: ты опоздал в правый дальний угол","en":"Singles: you are late into the deep forehand rear corner","ro":"Simplu: ai ajuns târziu în colțul din spate-dreapta"}',
    '{"ru":"Соперник сыграл быстрый плоский высоко-далёкий удар, и ты достаёшь волан в правом заднем углу за спиной в глубоком прогибе. Какой удар даст тебе время вернуться на базу в центр?","en":"Your opponent played a fast attacking clear and you reach the shuttle late behind your body in the deep forehand corner. Which shot gives you time to recover to base?","ro":"Adversarul a trimis o minge rapidă în spate și ajungi târziu, în spatele corpului. Ce lovitură îți oferă timp să revii în centru?"}',
    '[
      {"id":"a","text":{"ru":"Высокий глубокий защитный высоко-далёкий удар (High Clear) к задней линии соперника","en":"A high, deep defensive clear to the opponent''s back boundary line","ro":"Un clear înalt și adânc până pe linia de fund a adversarului"}},
      {"id":"b","text":{"ru":"Резкий смэш в полную силу из-за спины","en":"A full-power smash from behind the body","ro":"Un smash cu toată forța din spatele corpului"}},
      {"id":"c","text":{"ru":"Плоский драйв через центр на удобной для соперника высоте","en":"A flat mid-court drive through the middle","ro":"Un drive plat pe mijlocul terenului"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Когда ты выбит из позиции в заднем углу, главная задача — выиграть 2–2,5 секунды на возврат в центр. Высокий глубокий удар до задней линии летит дольше всего и не позволяет сопернику перехватить волан в средней зоне.","en":"When out of position in the deep corner, your priority is buying 2–2.5 seconds to recover to center base. A high deep clear maximizes flight time.","ro":"Când ești scos din poziție în spate, prioritatea este să câștigi 2–2,5 secunde pentru revenirea în centru printr-un clear înalt și lung."}',
    'BWF Coach Education — Singles Recovery Principles',
    NULL,
    true
  ),
  (
    'mistake_split_step_flat_feet',
    'find_mistake',
    'footwork',
    'beginner',
    10, 17,
    '{"ru":"Найди ошибку: почему игрок всегда опаздывает на первый шаг?","en":"Find the mistake: why is the player always late on the first step?","ro":"Găsește greșeala: de ce întârzie jucătorul mereu la primul pas?"}',
    '{"ru":"Спортсмен после своего удара возвращается в центр корта, встаёт на прямые ноги на всю стопу (пятки прижаты к полу) и ждёт, пока волан перелетит сетку, прежде чем начать движение. В чём главная техническая ошибка?","en":"After hitting, the player returns to center, stands tall on flat feet with heels planted, and waits until the shuttle crosses the net before moving. What is the key technical mistake?","ro":"După lovitură, jucătorul revine în centru, stă cu genunchii drepți pe toată talpa și așteaptă ca fluturașul să treacă fileul. Care este greșеala tehnică principală?"}',
    '[
      {"id":"a","text":{"ru":"Нет разножки (Split-step) в момент удара соперника по волану","en":"Missing the split-step timed with the opponent''s contact with the shuttle","ro":"Lipsește split-step-ul sincronizat cu momentul în care adversarul lovește fluturașul"}},
      {"id":"b","text":{"ru":"Нужно было остаться стоять в том углу, откуда нанёс удар","en":"He should have stayed in the corner where he hit","ro":"Trebuia să rămână în colțul din care a lovit"}},
      {"id":"c","text":{"ru":"Нужно держать ракетку двумя руками","en":"He should hold the racket with both hands","ro":"Trebuia să țină racheta cu două mâini"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Разножка (split-step) — лёгкий пружинящий подскок на подушечках стоп ровно в момент, когда соперник касается волана. Она предварительно растягивает икроножные мышцы и ахилл (эффект пружины) и экономит 0,15–0,25 секунды старта.","en":"A split-step on the balls of the feet timed at the opponent''s impact pre-loads the calf-Achilles elastic spring and saves 0.15–0.25s on the first step.","ro":"Split-step-ul pe vârfuri în momentul impactului adversarului încarcă elastic tendonul lui Ahile și economisește 0,15–0,25 secunde la start."}',
    'BWF Shuttle Time & Biomechanics of Footwork',
    NULL,
    true
  ),
  (
    'technique_lunge_knee_alignment',
    'technique',
    'technique',
    'beginner',
    10, 17,
    '{"ru":"Техника выпада к сетке: безопасность колена и голеностопа","en":"Net lunge technique: knee and ankle safety","ro":"Tehnica fandării la fileu: siguranța genunchiului și gleznei"}',
    '{"ru":"Как правильно ставить стопу и направлять колено ведущей (ракеточной) ноги при глубоком выпаде к сетке?","en":"How should you land the foot and align the knee of your racket leg during a deep lunge to the net?","ro":"Cum trebuie așezat piciorul și orientat genunchiul mâinii cu racheta la o fandare adâncă la fileu?"}',
    '[
      {"id":"a","text":{"ru":"Приземление с пятки на всю стопу, носок и колено смотрят строго по направлению выпада, колено не заваливается внутрь","en":"Heel-to-flat-foot landing, toe and knee pointing in the direction of the lunge, knee never collapsing inward","ro":"Contact călcâi-talpă, vârful și genunchiul orientate pe direcția fandării, fără prăbușirea genunchiului spre interior"}},
      {"id":"b","text":{"ru":"Приземление на носок с разворотом стопы поперёк и завалом колена внутрь","en":"Landing on tiptoe with foot turned sideways and knee collapsing inward","ro":"Aterizare pe vârf cu genunchiul prăbușit spre interior"}},
      {"id":"c","text":{"ru":"Прыжок на две прямые ноги одновременно","en":"Jumping onto two straight legs simultaneously","ro":"Săritură pe ambele picioare drepte simultan"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Приземление с пятки плавно гасит тормозной импульс (до 3–4 весов тела), а соосность «бедро — колено — носок» защищает связки колена и сухожилие надколенника от перегрузки.","en":"Heel-first braking absorbs 3–4× bodyweight forces safely, and keeping hip–knee–toe aligned prevents valgus stress on the patellar tendon and ACL.","ro":"Frânarea călcâi-talpă absoarbe șocul, iar alinierea șold–genunchi–vârf protejează ligamentele genunchiului."}',
    'BJSM / BWF Injury Prevention in Badminton',
    NULL,
    true
  ),
  (
    'phys_sleep_recovery_hormone',
    'physical_recovery',
    'recovery_prevention',
    'beginner',
    10, 17,
    '{"ru":"Сон и восстановление мышц у юных спортсменов","en":"Sleep and muscle recovery in youth athletes","ro":"Somnul și refacerea musculară la tinerii sportivi"}',
    '{"ru":"Сколько часов ночного сна рекомендуют спортивные врачи подросткам 12–17 лет в дни интенсивных тренировок, чтобы сухожилия восстанавливались, а скорость реакции на корте не падала?","en":"How many hours of night sleep do sports medicine guidelines recommend for 12–17-year-old athletes during heavy training blocks to maintain reaction speed and tendon recovery?","ro":"Câte ore de somn pe noapte recomandă medicii sportivi pentru sportivii de 12–17 ani în perioadele de antrenament intens?"}',
    '[
      {"id":"a","text":{"ru":"8,5–10 часов регулярного ночного сна","en":"8.5–10 hours of consistent night sleep","ro":"8,5–10 ore de somn constant pe noapte"}},
      {"id":"b","text":{"ru":"5–6 часов достаточно, если выпить кофе или энергетик","en":"5–6 hours is enough if you drink coffee or an energy drink","ro":"5–6 ore sunt suficiente cu o băutură energizantă"}},
      {"id":"c","text":{"ru":"Сон влияет только на настроение, но не на мышцы и риск травм","en":"Sleep only affects mood, not muscles or injury risk","ro":"Somnul afectează doar dispoziția, nu și riscul de accidentare"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Исследования (Milewski et al.) показали: подростки-спортсмены, спящие менее 8 часов за ночь, имеют в 1,7 раза более высокий риск травм. Пик выработки гормона роста и восстановления тканей приходится на фазу глубокого ночного сна.","en":"Studies (Milewski et al.) show adolescent athletes sleeping <8 hours/night have a 1.7× higher injury risk. Tissue repair peaks during deep night sleep.","ro":"Studiile arată că sportivii adolescenți care dorm sub 8 ore au un risc de 1,7× mai mare de accidentare."}',
    'Milewski et al., J Pediatr Orthop (Youth Athlete Sleep & Injury)',
    NULL,
    true
  ),
  (
    'cond_bwf_load_wave',
    'physical_recovery',
    'conditioning',
    'intermediate',
    11, 17,
    '{"ru":"Зачем нужен разгрузочный («зелёный») день после ударной тренировки?","en":"Why do you need a deload (''green'') day after a shock training day?","ro":"De ce este necesară o zi ușoară («verde») după un antrenament intens?"}',
    '{"ru":"Вчера у группы была тяжёлая ударная тренировка (90 мин, RPE 8 — многоволанка и прыжки). Почему по методике BWF на следующий день дают более лёгкую техническую работу (RPE 3), а не вторую подряд тренировку на максимум?","en":"Yesterday the group had a heavy shock session (90 min, RPE 8 — multifeeding & jumps). Why does BWF load management schedule a lighter technical session (RPE 3) next rather than another max day?","ro":"Ieri grupa a avut un antrenament foarte intens (90 min, RPE 8). De ce metodologia BWF prevede azi o ședință ușoară (RPE 3) în loc de încă o zi la maximum?"}',
    '[
      {"id":"a","text":{"ru":"Рост силы и выносливости (сверхкомпенсация) происходит во время восстановления после пика, а монотонная нагрузка без разгрузки ведёт к перегрузке сухожилий","en":"Supercompensation happens during recovery after a peak; monotonous high load without deload windows overloads tendons","ro":"Supracompensarea are loc în timpul refacerii după vârf; încărcătura monotonă fără descărcare suprasolicită tendoanele"}},
      {"id":"b","text":{"ru":"Потому что после тяжёлой тренировки запрещено брать ракетку в руки 7 дней","en":"Because touching a racket is forbidden for 7 days after a hard session","ro":"Pentru că este interzis să atingi racheta 7 zile după un antrenament greu"}},
      {"id":"c","text":{"ru":"Лёгкие дни ухудшают форму, нужно всегда тренироваться на RPE 9–10","en":"Light days ruin fitness; you should always train at RPE 9–10","ro":"Zilele ușoare scad forma; trebuie mereu RPE 9–10"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Принцип волнообразной периодизации BWF: ударный день создаёт тренировочный стимул, а следующий за ним разгрузочный день позволяет нервной системе и сухожилиям адаптироваться и выйти на новый уровень.","en":"BWF undulating periodization pairs shock peaks with deload valleys so the nervous system and tendons adapt and supercompensate.","ro":"Periodizarea ondulată BWF alternează vârfurile de efort cu ferestre de descărcare pentru adaptare și prevenirea accidentărilor."}',
    'BWF Sports Science — Training Load Management',
    NULL,
    true
  ),
  (
    'psych_19_19_breathing_routine',
    'psychology',
    'psychology',
    'beginner',
    10, 17,
    '{"ru":"Психология концовки: счёт 19:19, ты только что ошибся в сетку","en":"End-game psychology: 19–19 and you just netted an easy shot","ro":"Psihologia finalului de set: 19–19 și tocmai ai greșit în fileu"}',
    '{"ru":"В третьей партии счёт 19:19. Ты поторопился и пробил простой мяч в сетку, пульс подскочил, руки зажались. Что лучше всего сделать в следующие 10–12 секунд до следующей подачи?","en":"It''s 19–19 in the third game. You rushed and hit an easy shot into the net; your heart rate spikes and your grip tenses up. What is the best routine in the next 10–12 seconds before the next point?","ro":"Este 19–19 în setul decisiv. Ai greșit o minge ușoară în fileu, pulsul a crescut. Ce este cel mai bine să faci în următoarele 10–12 secunde?"}',
    '[
      {"id":"a","text":{"ru":"Отвернуться к задней линии, поправить струны, сделать медленный вдох и длинный выдох (4 сек вдох — 6 сек выдох) и сформулировать план только на 1 следующий розыгрыш (подача + первый удар)","en":"Turn toward the back line, adjust strings, take a slow inhale and longer exhale (4s in, 6s out), and focus only on the next serve + first shot","ro":"Întoarce-te spre linia de fund, aranjează corzile, fă o inspirație lentă și o expirație lungă (4s–6s) și fixează planul doar pentru serviciu + prima lovitură"}},
      {"id":"b","text":{"ru":"Сразу бежать к линии подачи и подавать без паузы, пока злой","en":"Rush straight to the service line and serve immediately while angry","ro":"Fugi imediat la linia de serviciu și servește fără pauză, la nervi"}},
      {"id":"c","text":{"ru":"Ругать себя вслух и думать о том, что будет, если проиграешь матч","en":"Scold yourself out loud and think about losing the match","ro":"Certă-te cu voce tare și gândește-te la înfrângere"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Ритуал «Сброс — Дыхание — Фокус на 1 удар»: удлинённый выдох активирует парасимпатическую нервную систему, снижает пульс и снимает зажим в кисти, а фокус на «подача + 1-й удар» возвращает контроль.","en":"The Reset–Breathe–Next-Shot routine: a prolonged exhale lowers heart rate and grip tension, while planning just serve + 1st shot restores tactical focus.","ro":"Rutina Reset–Respirație–Următoarea lovitură: expirația lungă scade pulsul și relaxează priza pe rachetă."}',
    'BWF Sport Psychology — Between-Point Routines',
    NULL,
    true
  ),
  (
    'iq_wind_drift_hall',
    'tactical',
    'game_iq',
    'advanced',
    12, 17,
    '{"ru":"Игровое мышление: в зале дует кондиционер («попутная» и «встречная» стороны)","en":"Game IQ: playing with hall drift (wind behind vs against you)","ro":"Gândire de joc: curentul de aer în sală (vânt din spate vs din față)"}',
    '{"ru":"На турнире ты заметил, что с твоей половины корта поток воздуха от вентиляции дует тебе В СПИНУ, и твои высоко-далёкие удары улетают за заднюю линию в аут. Как грамотно перестроить тактику на этой стороне?","en":"At a tournament you notice the hall air conditioning blows FROM BEHIND you, pushing your clears long out the back. How should you adjust your tactics on this end of the court?","ro":"La turneu observi că aerul condiționat bate DIN SPATELE tău, iar mingile lungi ies în aut pe spate. Cum îți adaptezi tactica pe această parte?"}',
    '[
      {"id":"a","text":{"ru":"Больше играть через сетку, укороченные и крутые смэши: перехватить инициативу в передней зоне и заставить соперника поднимать волан ПРОТИВ ветра (его свечи будут не долетать)","en":"Play more net shots, drops and steep smashes: control the front court and force the opponent to lift INTO the drift (their lifts will fall short)","ro":"Joacă mai mult la fileu, scurte și smash-uri abrupte: controlează fața și obligă adversarul să ridice ÎMPOTRIVA curentului (mingile lui vor rămâne scurte)"}},
      {"id":"b","text":{"ru":"Продолжать бить плоские высоко-далёкие удары в полную силу и надеяться, что ветер стихнет","en":"Keep hitting full-power flat clears and hope the drift stops","ro":"Continuă să lovești clear-uri plate cu toată forța"}},
      {"id":"c","text":{"ru":"Отдавать инициативу и постоянно поднимать высокие свечи к задней линии","en":"Give away the initiative and keep lifting high to the back line","ro":"Ridică mereu mingi înalte spre linia de fund"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"На «быстрой» (попутной) стороне волан легко улетает за заднюю линию, зато твой смэш летит быстрее, а сопернику тяжело добросить волан против ветра до твоей задней линии. Поэтому на попутной стороне выигрывает тот, кто забирает сетку и атакует!","en":"With the drift behind you, clears sail long but your smash is faster and your opponent''s lifts into the wind fall short. Control the net and attack!","ro":"Cu curentul din spate, smash-ul tău e mai rapid, iar mingile ridicate de adversar împotriva curentului rămân scurte — controlează fileul și atacă!"}',
    'BWF Tactical Match Analysis — Environmental Drift',
    NULL,
    true
  ),
  (
    'visual_singles_cross_net_open_court',
    'visual_tactical',
    'singles_tactics',
    'intermediate',
    10, 17,
    '{"ru":"Визуальная задача: соперник застрял в левом переднем углу — куда направить удар?","en":"Visual tactics: opponent stuck in the front-left corner — where do you play?","ro":"Tactică vizuală: adversarul e blocat în colțul față-stânga — unde trimiți fluturașul?"}',
    '{"ru":"Посмотри на схему корта: ты (синий игрок YOU) подошёл к сетке справа и берёшь волан высоко над тросом. Соперник (красный OPP) сместился слишком близко к сетке в свой правый передний угол и ждёт прямой ответ. Какая траектория (A, B или C) наиболее выигрышна?","en":"Look at the court diagram: you (blue YOU) take the shuttle high at the forehand net. Your opponent (red OPP) over-committed to their front corner expecting a straight net shot. Which trajectory (A, B or C) is the best winning choice?","ro":"Privește schema terenului: tu (albastru YOU) iei fluturașul sus la fileu în dreapta. Adversarul (roșu OPP) a rămas blocat în față-stânga. Care traiectorie (A, B sau C) este cea mai eficientă?"}',
    '[
      {"id":"a","text":{"ru":"Вариант A — быстрый атакующий перевод (пуш/лифт) в открытый дальний задний угол за спину сопернику","en":"Option A — fast attacking push/lift into the open deep rear corner behind the opponent","ro":"Varianta A — împingere/lob rapid de atac în colțul din spate rămas liber"}},
      {"id":"b","text":{"ru":"Вариант B — сыграть прямо в ракетку сопернику у сетки","en":"Option B — play straight into the opponent''s waiting racket at the net","ro":"Varianta B — trimite direct în racheta adversarului la fileu"}},
      {"id":"c","text":{"ru":"Вариант C — мягкий наброс в центр корта на удобную высоту","en":"Option C — soft mid-court lift to the center","ro":"Varianta C — minge moale pe mijlocul terenului"}}
    ]'::jsonb,
    ARRAY['a'],
    '{"ru":"Когда соперник «завис» в переднем углу с весом тела впереди, резкий атакующий перевод по диагонали или по линии в открытый задний угол (A) заставляет его разворачиваться и бежать через весь корт спиной назад.","en":"When the opponent''s weight is committed forward at the net, a flat attacking push/lift into the open rear corner (A) forces the longest diagonal recovery.","ro":"Când greutatea adversarului e în față la fileu, o minge rapidă în colțul lung liber (A) îl obligă la cea mai grea deplasare pe diagonală."}',
    'BWF Coach Education — Space Creation in Singles',
    '{
      "players": [
        {"id":"you","label":"YOU","team":"you","x":76,"y":62},
        {"id":"opp","label":"OPP","team":"opp","x":74,"y":36}
      ],
      "shuttle": {"x":76,"y":56},
      "arrows": [
        {"from":[76,56],"to":[22,12],"label":"A","tone":"accent"},
        {"from":[76,56],"to":[75,38],"label":"B","tone":"muted"},
        {"from":[76,56],"to":[50,28],"label":"C","tone":"muted"}
      ]
    }'::jsonb,
    true
  )
ON CONFLICT (code) DO NOTHING;

-- 9. Seed an active monthly knowledge check using the seeded questions.
INSERT INTO public.academy_tests (
  code, title, description, topics, difficulty, question_ids, question_count,
  time_limit_minutes, available_from, available_until, max_attempts, published
)
SELECT
  'monthly_foundations_01',
  '{"ru":"Месячный зачёт: Правила, Тактика и Восстановление","en":"Monthly Check: Rules, Tactics & Recovery","ro":"Test lunar: Reguli, Tactică și Refacere"}'::jsonb,
  '{"ru":"Проверим знания правил BWF, тактики одиночной и парной игры, техники выпада и восстановления. Это учебный тест для твоего развития — после сдачи ты увидишь подробный разбор каждого вопроса!","en":"Check your knowledge of BWF rules, singles & doubles tactics, lunge safety and recovery. Educational quiz — full explanations appear right after submission!","ro":"Verifică cunoștințele despre regulile BWF, tactică, fandare și refacere. După trimitere vei vedea explicația fiecărei întrebări!"}'::jsonb,
  ARRAY['rules','singles_tactics','doubles_tactics','footwork','technique','recovery_prevention','conditioning','psychology','game_iq'],
  'beginner',
  ARRAY(
    SELECT id FROM public.academy_items
    WHERE item_type <> 'fact'
    ORDER BY created_at
  ),
  10,
  12,
  CURRENT_DATE - INTERVAL '7 days',
  CURRENT_DATE + INTERVAL '60 days',
  2,
  true
ON CONFLICT (code) DO UPDATE SET
  question_ids = EXCLUDED.question_ids,
  question_count = EXCLUDED.question_count;
