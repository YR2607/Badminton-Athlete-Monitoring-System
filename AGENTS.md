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

## Bundle analysis

`npm run analyze` — builds and opens the bundle analyzer reports.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
