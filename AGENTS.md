# RallyMonitor — agent notes

## Verify before claiming done

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (2 known RHF watch() warnings are informational)
npm test            # vitest unit tests
npm run build       # needs NEXT_PUBLIC_SUPABASE_* env (placeholders OK)
```

RLS integration tests need a real project:

```bash
RUN_RLS_TESTS=1 SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
  SUPABASE_PUBLISHABLE_KEY=... npx vitest run tests/rls.integration.test.ts
```

## Conventions

- i18n: все UI-строки в `src/i18n/{ru,en,ro}.ts`; тип Dictionary гарантирует
  полноту переводов — добавляй ключ во все три словаря.
- Доступ: чтение через RLS-клиент (`lib/supabase/server`), записи
  производных (snapshots/alerts/notifications/audit) — через
  `createAdminClient()` только после проверки сессии.
- Даты: календарные даты считаем в таймзоне профиля через `lib/dates.ts`
  (`localDate`, `todayInTz`), не через `toISOString().slice(0,10)`.
- DB: миграции в `supabase/migrations/`; после изменений `supabase db push`.
