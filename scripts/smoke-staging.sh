#!/usr/bin/env bash
# Smoke-check a deployed RallyMonitor environment (staging or production).
#
#   APP_URL=https://rallymonitor.vercel.app ./scripts/smoke-staging.sh
#   APP_URL=... CRON_SECRET=xxx ./scripts/smoke-staging.sh   # also runs authorized cron
#
# Only safe checks: unauthorized/forbidden responses and an idempotent,
# dedup-keyed authorized cron call.
set -euo pipefail

APP_URL="${APP_URL:?set APP_URL (deployment origin, no trailing slash)}"
fail=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 — expected $2, got $3"; fail=1; fi
}

code=$(curl -sS -o /dev/null -w "%{http_code}" "$APP_URL/login")
check "GET /login" 200 "$code"

code=$(curl -sS -o /dev/null -w "%{http_code}" "$APP_URL/api/cron/reminders")
check "cron without token -> 403" 403 "$code"

code=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-secret" "$APP_URL/api/cron/reminders")
check "cron with wrong token -> 403" 403 "$code"

if [ -n "${CRON_SECRET:-}" ]; then
  body=$(curl -sS -w $'\n%{http_code}' \
    -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/reminders")
  code=${body##*$'\n'}; json=${body%$'\n'*}
  check "cron with CRON_SECRET -> 200" 200 "$code"
  echo "  response: $json"
else
  echo "SKIP  authorized cron call (CRON_SECRET not set)"
fi

exit "$fail"
