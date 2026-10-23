#!/usr/bin/env bash
# Restore drill: dump the production database and restore it into a throwaway
# Supabase project, then verify row counts. Proves backups are actually usable.
#
# Prerequisites: pg_dump + psql (macOS: `brew install libpq && brew link --force libpq`
# or use the binaries from Postgres.app).
#
# Usage:
#   PROD_DB_URL="postgresql://postgres:<prod-pw>@db.jbkqagywdeiocmcztewb.supabase.co:5432/postgres" \
#   TEST_DB_URL="postgresql://postgres:<test-pw>@db.<test-ref>.supabase.co:5432/postgres" \
#   ./scripts/restore-drill.sh
#
# Connection strings: Supabase dashboard → Project Settings → Database →
# "Connection string" (use the *direct* connection, not the pooler).
set -euo pipefail

: "${PROD_DB_URL:?prod connection string required}"
: "${TEST_DB_URL:?throwaway project connection string required}"

command -v pg_dump >/dev/null || { echo "pg_dump not found — brew install libpq"; exit 1; }
command -v psql    >/dev/null || { echo "psql not found — brew install libpq"; exit 1; }

if [ "$PROD_DB_URL" = "$TEST_DB_URL" ]; then
  echo "REFUSING: TEST_DB_URL equals PROD_DB_URL"; exit 1
fi

DUMP="restore-drill-$(date +%Y%m%d-%H%M%S).sql"
trap 'rm -f "$DUMP"' EXIT

echo "==> Dumping production (data + schema)…"
pg_dump "$PROD_DB_URL" --no-owner --no-privileges -f "$DUMP"
echo "    $(wc -l < "$DUMP") lines, $(du -h "$DUMP" | cut -f1)"

echo "==> Restoring into TEST project…"
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP" 2>&1 | tail -5

echo "==> Row-count verification (prod vs test)…"
for t in profiles athletes groups group_memberships morning_checkins \
         post_training_checkins training_sessions readiness_snapshots alerts; do
  p=$(psql "$PROD_DB_URL" -tAc "SELECT count(*) FROM $t")
  q=$(psql "$TEST_DB_URL" -tAc "SELECT count(*) FROM $t")
  status=$([ "$p" = "$q" ] && echo OK || echo MISMATCH)
  printf "  %-28s prod=%-6s test=%-6s %s\n" "$t" "$p" "$q" "$status"
done

echo "==> Done. Dump removed. If all counts OK — backups are restorable."
