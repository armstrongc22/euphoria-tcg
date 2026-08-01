#!/usr/bin/env bash
# ============================================================================
# join_pvp_room migration + metadata + fail-loud checks (DISPOSABLE DB only).
# ============================================================================
# Applies the base PvP schema then the grant-hardening migration, verifies the
# function metadata via the real catalog, confirms an idempotent rerun, and
# proves every fail-loud assertion raises (inside rolled-back transactions, so
# the schema is restored after each destructive case). Reads only $SUPABASE_DB_URL
# and never prints it. Requires bash + psql + node. NEVER point at production.
#
# OUTPUT SAFETY: psql's stderr is captured to a scratch file and classified by
# db-error.mjs before anything is reported — raw stderr is never echoed, teed or
# copied into a report, because connection failures embed the pooler hostname,
# its resolved IP, the tenant username and the project ref. Connection failures
# report the bare category DATABASE_CONNECTIVITY_FAILED with no detail at all.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "FAIL: SUPABASE_DB_URL is not set (direct connection string for the DISPOSABLE branch)." >&2
  exit 1
fi
command -v psql >/dev/null 2>&1 || { echo "FAIL: psql is required." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required (database-error classification)." >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BASE="$REPO/supabase/migrations/20260702120000_pvp_schema.sql"
GRANT="$REPO/supabase/migrations/20260720120000_join_pvp_room_grants.sql"

# Scratch space for captured stderr. Never uploaded, removed on exit.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pvp-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PSQL_OPTS=(-X -q -w -v ON_ERROR_STOP=1)

# Turn a captured stderr file into a safe, reportable category (+ redacted
# one-line detail for query errors). The raw file itself is never printed.
classify() { node "$HERE/db-error.mjs" --file "$1"; }

# Run psql discarding stdout; stderr is captured for classification only.
psql_quiet() { psql "$SUPABASE_DB_URL" "${PSQL_OPTS[@]}" "$@" >/dev/null 2>"$TMP/last.err"; }

# Single scalar value. On failure prints nothing and leaves a classified
# summary in $TMP/last.summary (read it with db_error).
scalar() {
  : > "$TMP/last.summary"
  local out
  if out="$(psql "$SUPABASE_DB_URL" "${PSQL_OPTS[@]}" -t -A -c "$1" 2>"$TMP/last.err")"; then
    printf '%s' "$out"
  else
    classify "$TMP/last.err" > "$TMP/last.summary"
  fi
}
db_error() { if [ -s "$TMP/last.summary" ]; then cat "$TMP/last.summary"; else echo "UNKNOWN_DATABASE_ERROR"; fi; }

pass=0; fail=0
ok(){ echo "PASS: $1"; pass=$((pass+1)); }
no(){ echo "FAIL: $1"; fail=$((fail+1)); }

echo "== join_pvp_room migration + metadata + fail-loud checks =="

# --- 0) Connectivity preflight (category only; never the connection error) ---
if ! psql_quiet -c 'select 1'; then
  no "database connectivity ($(classify "$TMP/last.err"))"
  echo "== PvP migration checks: $pass passed, $fail failed (aborted before any change) =="
  exit 1
fi
ok "connected to the target database"

# --- 1) Apply base PvP schema, then the grant migration (+ rerun) -----------
if psql_quiet -f "$BASE"; then ok "base PvP schema applied"; else no "base schema failed ($(classify "$TMP/last.err"))"; exit 1; fi
BODY_BEFORE="$(scalar "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'")"
[ -n "$BODY_BEFORE" ] || no "could not read the pre-migration function body ($(db_error))"
if psql_quiet -f "$GRANT"; then ok "grant migration applied (run #1)"; else no "grant migration failed ($(classify "$TMP/last.err"))"; fi
if psql_quiet -f "$GRANT"; then ok "grant migration reran (run #2, idempotent)"; else no "grant migration rerun failed ($(classify "$TMP/last.err"))"; fi

# --- 2) Catalog metadata ----------------------------------------------------
META="$(scalar "select
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'),
   (to_regprocedure('public.join_pvp_room(text)') is not null),
   p.prosecdef, pg_get_userbyid(p.proowner), array_to_string(p.proconfig,','), md5(p.prosrc),
   replace(pg_get_function_arguments(p.oid),' ','~')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'")"
if [ -z "$META" ]; then
  no "could not read function metadata ($(db_error))"
  echo "== PvP migration checks: $pass passed, $fail failed =="
  exit 1
fi
read -r OVERLOADS TEXTSIG DEFINER OWNER CFG BODY_AFTER ARGS <<EOF
$(printf '%s' "$META" | tr '|' ' ')
EOF
[ "$OVERLOADS" = "1" ] && ok "exactly one public.join_pvp_room overload" || no "overloads=$OVERLOADS (expected 1)"
[ "$TEXTSIG" = "t" ] && ok "identity signature is (text)" || no "no (text) overload"
echo "  (identity arguments: ${ARGS//\~/ })"
[ "$DEFINER" = "t" ] && ok "SECURITY DEFINER" || no "not SECURITY DEFINER"
[ "$CFG" = "search_path=public" ] && ok "search_path is exactly 'public'" || no "search_path='$CFG' (expected search_path=public)"
[ "$OWNER" = "postgres" ] && ok "owner is the migration role (postgres)" || no "owner=$OWNER (expected postgres)"
[ "$BODY_AFTER" = "$BODY_BEFORE" ] && ok "function body unchanged by the grant migration" || no "function body changed by the grant migration"

# --- 3) Grants matrix (unambiguous, via catalog) ----------------------------
grant_is() { local role="$1" exp="$2"; local v; v="$(scalar "select has_function_privilege('$role','public.join_pvp_room(text)','execute')")"; \
  if [ -z "$v" ]; then no "grant: $role execute unreadable ($(db_error))"; \
  elif [ "$v" = "$exp" ]; then ok "grant: $role execute = $exp"; \
  else no "grant: $role execute = $v (expected $exp)"; fi; }
grant_is anon f
grant_is authenticated t
grant_is service_role f

# --- 4) Fail-loud regression, each in a rolled-back transaction (restored) ---
faildo() { # <name> <destructive-sql> <expected-msg-regex>
  local name="$1" ddl="$2" want="$3"
  # Combined output is captured to a scratch file and only ever grepped, never
  # printed: on an inconclusive result we report the classified category.
  psql "$SUPABASE_DB_URL" "${PSQL_OPTS[@]}" >"$TMP/faildo.out" 2>&1 <<SQL || true
begin;
$ddl
\\i $GRANT
select 'GUARD_DID_NOT_FIRE' as r;
rollback;
SQL
  if grep -qiE "$want" "$TMP/faildo.out"; then ok "fail-loud: $name raises"
  elif grep -q GUARD_DID_NOT_FIRE "$TMP/faildo.out"; then no "fail-loud: $name did NOT raise"
  else no "fail-loud: $name inconclusive ($(classify "$TMP/faildo.out"))"; fi
  # confirm the real function is restored (rollback) and still (text) + granted to authenticated
  local ok_after; ok_after="$(scalar "select has_function_privilege('authenticated','public.join_pvp_room(text)','execute')")"
  [ "$ok_after" = "t" ] || no "  restore check: authenticated grant missing after '$name'"
}
faildo "missing function"      "drop function public.join_pvp_room(text);" "is missing"
faildo "wrong signature"       "drop function public.join_pvp_room(text); create function public.join_pvp_room(p_id uuid) returns void language plpgsql security definer set search_path=public as \$f\$ begin end; \$f\$;" "expected signature"
faildo "second overload"       "create function public.join_pvp_room(p_id uuid) returns void language plpgsql security definer set search_path=public as \$f\$ begin end; \$f\$;" "exactly one overload"
faildo "not SECURITY DEFINER"  "create or replace function public.join_pvp_room(p_code text) returns public.pvp_rooms language plpgsql set search_path=public as \$f\$ declare r public.pvp_rooms; begin return r; end; \$f\$;" "not SECURITY DEFINER"
faildo "no fixed search_path"  "create or replace function public.join_pvp_room(p_code text) returns public.pvp_rooms language plpgsql security definer as \$f\$ declare r public.pvp_rooms; begin return r; end; \$f\$;" "lacks a fixed search_path"

echo "== PvP migration checks: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
