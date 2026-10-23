-- RallyMonitor: auth bootstrap + default alert rules

-- Auto-create a profile when an auth user is provisioned by an admin.
-- Expected user_metadata keys: display_name, role ('athlete'|'coach'|'admin'),
-- timezone, preferred_language, athlete_code (for athletes).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role;
  v_profile_id uuid;
begin
  v_role := coalesce(nullif(new.raw_user_meta_data->>'role',''), 'athlete')::public.app_role;

  insert into public.profiles (user_id, display_name, role, preferred_language, timezone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'preferred_language',''), 'ru'),
    coalesce(nullif(new.raw_user_meta_data->>'timezone',''), 'Europe/Chisinau')
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name
  returning id into v_profile_id;

  if v_role = 'athlete' then
    insert into public.athletes (profile_id, athlete_code, birth_year)
    values (
      v_profile_id,
      coalesce(nullif(new.raw_user_meta_data->>'athlete_code',''),
               'ATH-' || upper(substr(replace(new.id::text,'-',''),1,8))),
      nullif(new.raw_user_meta_data->>'birth_year','')::smallint
    )
    on conflict (profile_id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- default alert rules ----------
insert into public.alert_rules (code, severity, params, description) values
  ('acute_pain',            'priority',
    '{"pain_statuses":["acute_instability"],"swelling":true,"movement_limitation":true,"min_severity":7}',
    'Острая боль, боль с отёком, ограничение движения или нестабильность сустава'),
  ('illness_symptoms',      'priority',
    '{"keywords":true}',
    'Выраженные симптомы заболевания, слабость, головокружение'),
  ('joint_pain',            'review_load',
    '{"pain_statuses":["joint_tendon"],"min_severity":5}',
    'Боль в суставе или сухожилии средней и выше интенсивности'),
  ('readiness_drop',        'attention',
    '{"sd_below":1.0,"min_abs_drop":10}',
    'Готовность ниже личной нормы больше чем на 1 стандартное отклонение'),
  ('sustained_decline',     'review_load',
    '{"days":3,"below_baseline":true}',
    'Состояние хуже личной нормы 3 дня подряд'),
  ('load_spike',            'attention',
    '{"ratio":1.5,"min_acute_minutes":0}',
    'Нагрузка за последние 7 дней выросла более чем в 1.5 раза относительно предыдущих 7 дней'),
  ('load_with_decline',     'review_load',
    '{"load_ratio":1.3,"readiness_below_baseline":true}',
    'Рост нагрузки на фоне ухудшения самочувствия'),
  ('repeated_fatigue',      'attention',
    '{"days":3,"fatigue_min":7}',
    'Высокая субъективная усталость несколько дней подряд'),
  ('missing_morning',       'attention',
    '{"after_local_hour":12}',
    'Утренняя анкета не заполнена к полудню (информационно для тренера)')
on conflict (code) do nothing;

-- Default recovery recommendations by normalized score band.
create table if not exists public.recommendation_texts (
  id uuid primary key default gen_random_uuid(),
  band text not null unique, -- 'good' | 'moderate' | 'low'
  text_ru text not null,
  text_ro text,
  text_en text
);
alter table public.recommendation_texts enable row level security;
create policy recommendation_texts_read on public.recommendation_texts
  for select using (auth.role() = 'authenticated');
create policy recommendation_texts_admin on public.recommendation_texts
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.recommendation_texts (band, text_ru, text_en, text_ro) values
  ('good',
   'Самочувствие в норме. Можно выполнять запланированную тренировку.',
   'You are within your normal range. Follow the planned session.',
   'Te simți în limite normale. Poți face antrenamentul planificat.'),
  ('moderate',
   'Восстановление ниже обычного. Уменьши интенсивность, больше отдыхай, поспи и расскажи тренеру, как себя чувствуешь.',
   'Recovery is below your usual level. Reduce intensity, rest more, sleep well and tell your coach how you feel.',
   'Recuperarea este sub nivelul obișnuit. Redu intensitatea, odihnește-te mai mult și spune antrenorului cum te simți.'),
  ('low',
   'Самочувствие заметно хуже обычного. Обязательно скажи тренеру до начала тренировки — возможно, нагрузку стоит снизить или заменить на восстановление.',
   'You feel notably worse than usual. Tell your coach before training — the load may need to be reduced or replaced with recovery work.',
   'Te simți vizibil mai rău decât de obicei. Spune antrenorului înainte de antrenament — sarcina ar putea fi redusă.')
on conflict (band) do nothing;
