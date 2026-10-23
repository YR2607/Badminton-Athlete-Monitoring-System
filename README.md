# RallyMonitor

Система мониторинга физического состояния, восстановления и тренировочной
нагрузки бадминтонистов 10–17 лет. Веб-приложение с ролями **спортсмен /
тренер / администратор**, утренними и послетренировочными анкетами, расчётом
готовности, rule-based предупреждениями, аналитикой и экспортом.

## Стек

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- Supabase (PostgreSQL + Auth + Row Level Security)
- Recharts, React Hook Form + Zod, SheetJS (xlsx), Vitest

## Структура

```
src/
  app/            # страницы и API (athlete/, coach/, admin/, api/)
  app/actions/    # server actions (auth, checkins, coach, admin, settings, notifications)
  components/     # ui/, forms/, charts/, layout/
  lib/            # supabase clients, readiness engine, alert engine, export, dates
  i18n/           # словари ru/ro/en (Dictionary-тип гарантирует полноту)
supabase/
  migrations/     # 0001_schema, 0002_rls, 0003_functions_seed
  seed.sql        # демо-группа и расписание (без auth-пользователей)
tests/            # unit-тесты движков + RLS integration (opt-in)
docs/             # database.md, readiness.md, alerts.md
```

## Настройка Supabase

1. Создайте проект на https://supabase.com (бесплатный tier подходит).
2. Установите CLI (уже предполагается): `supabase link --project-ref <ref>`
   либо выполняйте SQL вручную в SQL Editor.
3. Примените миграции: `supabase db push`
   (или выполните файлы `supabase/migrations/*.sql` по порядку в SQL Editor).
4. Опционально: `supabase/seed.sql` для демо-группы.
5. Скопируйте `.env.example` → `.env.local` и заполните:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     (Project Settings → API; также принимается legacy `..._ANON_KEY`)
   - `SUPABASE_SECRET_KEY` — только сервер, никогда не в клиенте
     (legacy `SUPABASE_SERVICE_ROLE_KEY` тоже поддерживается)
   - `CRON_SECRET` — для `/api/cron/reminders`
6. Создайте первого администратора: в Supabase Dashboard → Authentication →
   Users → Add user, затем в SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
   where user_id = '<user-uuid>';
   ```
   (Профиль создаётся автоматически триггером `handle_new_user`.)

## Локальный запуск

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest (unit)
npm run build      # production build
```

## Деплой на Vercel

1. Импортируйте репозиторий в Vercel.
2. Добавьте env-переменные из `.env.example` (включая `CRON_SECRET` и
   `NEXT_PUBLIC_SITE_URL=https://<домен>`).
3. Напоминания: на Hobby-плане Vercel Cron недоступен чаще раза в день, поэтому
   используется внешний планировщик — GitHub Actions
   `.github/workflows/cron-reminders.yml` (нужны repo `secrets.CRON_SECRET` и
   `vars.APP_URL`) или cron-job.org; оба ходят на `/api/cron/reminders` с
   `Authorization: Bearer $CRON_SECRET` каждые ~15 мин.
4. В Supabase → Authentication → URL Configuration укажите Site URL и
   redirect URL `https://<домен>/reset-password`.

## Роли и доступ

- **Спортсмен**: свои анкеты, история, графики, настройки. Не видит чужие
  данные, заметки тренера и alerts (политики RLS).
- **Тренер**: dashboard группы, карточки спортсменов, предупреждения, заметки,
  экспорт — только для назначенных ему спортсменов/групп.
- **Администратор**: пользователи, группы, назначения, расписание, правила,
  аудит, согласия.

Все проверки доступа выполняются на уровне БД через RLS (`supabase/migrations/
0002_rls.sql`) и повторно — в server actions. Экспорт дополнительно пишется в
`audit_logs`.

## Алгоритм готовности

См. `docs/readiness.md`. Коротко: шесть шкал 1–5 нормализуются в 0..1
(усталость/болезненность/стресс инвертируются), взвешенная сумма → 0..100.
Базовая норма — среднее/SD по первым ≤14 дням наблюдений, минимум 8 анкет;
иначе `confidence = insufficient`.

## Предупреждения

См. `docs/alerts.md`. Rule-based, 4 уровня; боль/симптомы — приоритет и не
маскируются высоким баллом готовности. Дедупликация по `dedup_key`
(athlete+rule+date), статусы open/acknowledged/resolved/dismissed.

## Экспорт

`/coach/export` → `GET /api/export` — CSV, XLSX (листы Summary / Athletes /
Morning Check-ins / Training Sessions / Post-Training Check-ins / Alerts) и
HTML-отчёт для печати в PDF.

## Тесты

- `npm test` — unit: нормализация, readiness score, baseline, правила
  предупреждений, дедупликация, валидация, диапазоны дат.
- RLS-интеграция (требует живой проект):
  ```bash
  RUN_RLS_TESTS=1 SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
    SUPABASE_PUBLISHABLE_KEY=... npx vitest run tests/rls.integration.test.ts
  ```

## Известные ограничения

- PDF-отчёт реализован как печатная HTML-страница (Print → Save as PDF), без
  внешних зависимостей.
- Push/email/Telegram-уведомления не реализованы — есть внутренние
  уведомления и точка расширения в `/api/cron/reminders`.
- Хранение данных/retention политику нужно настроить в Supabase под требования
  вашей юрисдикции (см. `consent_records`).
