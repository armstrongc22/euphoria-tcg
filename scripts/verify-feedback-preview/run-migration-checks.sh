#!/usr/bin/env bash
# ============================================================================
# Migration checks for feedback_reports against a DISPOSABLE Supabase database.
# ============================================================================
# Applies the EXACT PR #85 migration, verifies an idempotent rerun, and proves
# the stale-schema guard fails loudly. Read-only about credentials: it only
# reads $SUPABASE_DB_URL (a direct Postgres connection string for the disposable
# branch) and never prints it.
#
#   export SUPABASE_DB_URL='postgresql://postgres:...@db.<preview-ref>.supabase.co:5432/postgres'
#   bash scripts/verify-feedback-preview/run-migration-checks.sh
#
# NEVER point this at production. Requires: bash, psql.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "FAIL: SUPABASE_DB_URL is not set (direct Postgres connection string for the DISPOSABLE branch)." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20260720121000_feedback_reports.sql"
PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q)

pass=0; fail=0
ok(){ echo "PASS: $1"; pass=$((pass+1)); }
no(){ echo "FAIL: $1"; fail=$((fail+1)); }

echo "== feedback_reports migration checks (disposable DB) =="

# --- 1) Clean apply (idempotent even if the branch auto-applied it) ----------
if "${PSQL[@]}" -f "$MIGRATION" >/dev/null 2>apply1.err; then
  ok "migration applied (run #1)"
else
  no "migration failed on run #1"; sed 's/^/    /' apply1.err; exit 1
fi

# --- 2) Idempotent rerun ----------------------------------------------------
before="$("${PSQL[@]}" -t -A -c "select count(*) from public.feedback_reports")"
if "${PSQL[@]}" -f "$MIGRATION" >/dev/null 2>apply2.err; then
  ok "migration reran without error (run #2, guarded/idempotent)"
else
  no "migration failed on rerun"; sed 's/^/    /' apply2.err
fi
after="$("${PSQL[@]}" -t -A -c "select count(*) from public.feedback_reports")"
if [ "$before" = "$after" ]; then
  ok "rerun changed no rows (before=$before after=$after)"
else
  no "rerun changed row count (before=$before after=$after)"
fi

# --- 3) Stale/incompatible-table guard must fail loudly ---------------------
# Inside a rolled-back transaction: hide the good table, put an old-schema one
# in its place, run the migration, and confirm it RAISES. ON_ERROR_STOP aborts
# the transaction on the expected error; the session end rolls it back, so the
# real table is restored untouched.
stale_out="$(psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 2>&1 <<SQL || true
begin;
alter table if exists public.feedback_reports rename to feedback_reports__verify_backup;
create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email text, type text not null, message text not null,
  created_at timestamptz not null default now()
);
\i $MIGRATION
-- If we reach here the guard did NOT fire.
select 'STALE_GUARD_DID_NOT_FIRE' as result;
rollback;
SQL
)"
if printf '%s' "$stale_out" | grep -q "without a client_key column"; then
  ok "stale-schema guard fired loudly (incompatible pre-existing table rejected)"
elif printf '%s' "$stale_out" | grep -q "STALE_GUARD_DID_NOT_FIRE"; then
  no "stale-schema guard did NOT fire — the migration silently accepted an incompatible table"
else
  no "stale-schema test inconclusive; raw output:"; printf '%s\n' "$stale_out" | sed 's/^/    /'
fi

# Confirm the real table is intact after the rolled-back stale test.
if "${PSQL[@]}" -t -A -c \
  "select 1 from information_schema.columns where table_schema='public' and table_name='feedback_reports' and column_name='client_key'" \
  | grep -q 1; then
  ok "real table intact after stale test (client_key present)"
else
  no "real table missing client_key after stale test — investigate manually"
fi

rm -f apply1.err apply2.err
echo "== migration checks: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
