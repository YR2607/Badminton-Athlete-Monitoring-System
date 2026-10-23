# Схема базы данных

PostgreSQL (Supabase). Миграции: `supabase/migrations/0001..0003`.
Все таблицы под Row Level Security (`0002_rls.sql`).

## Таблицы

- **profiles** — user_id → auth.users, display_name, role (athlete|coach|admin),
  preferred_language, timezone. Создаётся триггером `handle_new_user` из
  user_metadata. Самостоятельная смена role запрещена триггером.
- **athletes** — profile_id (1:1), athlete_code (unique), birth_year
  (минимизация данных — только год), status (active|inactive|archived).
- **groups / group_memberships** — составы; left_at NULL = активный член
  (partial unique index на активную запись).
- **coach_assignments** — coach→group ИЛИ coach→athlete
  (`num_nonnulls = 1`), unique-пары.
- **training_schedules** — недельное расписание группы (weekday, start_time,
  type) для напоминаний и «пропущенных анкет».
- **morning_checkins** — одна анкета на (athlete_id, checkin_date); шесть
  шкал 1–5, блок боли (status/location/side/severity/onset/triggers/
  swelling/limitation), symptoms, client_uuid — идемпотентность.
- **training_sessions** — started_at; с миграции 0006 duration_minutes,
  session_rpe nullable (параметры не собираются — запись это
  маркер «тренировка была», создаётся автоматически с вечерней анкетой).
  Колонка training_type удалена миграцией 0007 (типов тренировок больше нет).
  session_load = duration×rpe (GENERATED ALWAYS → NULL для новых записей).
- **post_training_checkins** — 1:1 с session (unique training_session_id),
  шкалы самочувствия/ног/рук, блок боли.
- **readiness_snapshots** — производные от анкет: score 0–100,
  normalized_scores, baseline avg/sd/version, input_data_count, confidence,
  explanation. Upsert по (athlete_id, snapshot_date).
- **alert_rules** — настраиваемые правила (params jsonb, enabled, version).
- **alerts** — dedup_key unique, статус, evidence, recommendation,
  reviewed_by/at, resolution_note.
- **coach_notes** — kind (note|decision), видимы только тренерам/админу.
- **consent_records** — тип/статус/отзыв согласия (родитель/представитель).
- **notifications** — внутренние уведомления, dedup_key, read_at.
- **audit_logs** — кто/что/над чем, jsonb metadata. Читают только админы.

## RLS-политики (сводка)

- Спортсмен: SELECT/INSERT своих анкет и сессий; UPDATE — только «сегодня»
  в его таймзоне (задним числом нельзя). Не видит alerts и coach_notes.
- Тренер: SELECT данных своих спортсменов (через `can_access_athlete`:
  прямое назначение ИЛИ членство в назначенной группе); update анкет;
  review alerts; CRUD своих заметок.
- Админ: полный доступ.
- Записи в readiness_snapshots/alerts — через security-definer RPC
  `record_alert` и service-role серверную логику.

## Индексы

athlete_id+date на check-ins/sessions/snapshots; status-частичный на alerts;
unread-частичный на notifications; memberships/assignments по FK.
