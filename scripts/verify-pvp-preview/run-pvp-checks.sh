#!/usr/bin/env bash
# ============================================================================
# join_pvp_room migration + metadata + fail-loud checks (DISPOSABLE DB only).
# ============================================================================
# Applies the base PvP schema then the grant-hardening migration, verifies the
# function metadata via the real catalog, confirms an idempotent rerun, and
# proves every fail-loud assertion raises (inside rolled-back transactions, so
# the schema is restored after each destructive case). Reads only $SUPABASE_DB_URL
# and never prints it. Requires bash + psql. NEVER point at production.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "FAIL: SUPABASE_DB_URL is not set (direct connection string for the DISPOSABLE branch)." >&2
  exit 1
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BASE="$REPO/supabase/migrations/20260702120000_pvp_schema.sql"
GRANT="$REPO/supabase/migrations/20260720120000_join_pvp_room_grants.sql"
PSQL=(psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1)
scalar() { "${PSQL[@]}" -t -A -c "$1"; }

pass=0; fail=0
ok(){ echo "PASS: $1"; pass=$((pass+1)); }
no(){ echo "FAIL: $1"; fail=$((fail+1)); }

echo "== join_pvp_room migration + metadata + fail-loud checks =="

# --- 1) Apply base PvP schema, then the grant migration (+ rerun) -----------
if "${PSQL[@]}" -f "$BASE" >/dev/null 2>base.err; then ok "base PvP schema applied"; else no "base schema failed"; sed 's/^/    /' base.err; exit 1; fi
BODY_BEFORE="$(scalar "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'")"
if "${PSQL[@]}" -f "$GRANT" >/dev/null 2>g1.err; then ok "grant migration applied (run #1)"; else no "grant migration failed"; sed 's/^/    /' g1.err; fi
if "${PSQL[@]}" -f "$GRANT" >/dev/null 2>g2.err; then ok "grant migration reran (run #2, idempotent)"; else no "grant migration rerun failed"; sed 's/^/    /' g2.err; fi

# --- 2) Catalog metadata ----------------------------------------------------
read -r OVERLOADS TEXTSIG DEFINER OWNER CFG BODY_AFTER ARGS <<EOF
$(scalar "select
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'),
   (to_regprocedure('public.join_pvp_room(text)') is not null),
   p.prosecdef, pg_get_userbyid(p.proowner), array_to_string(p.proconfig,','), md5(p.prosrc),
   replace(pg_get_function_arguments(p.oid),' ','~')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='join_pvp_room'" | tr '|' ' ')
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
  [ "$v" = "$exp" ] && ok "grant: $role execute = $exp" || no "grant: $role execute = $v (expected $exp)"; }
grant_is anon f
grant_is authenticated t
grant_is service_role f

# --- 4) Fail-loud regression, each in a rolled-back transaction (restored) ---
faildo() { # <name> <destructive-sql> <expected-msg-regex>
  local name="$1" ddl="$2" want="$3" out
  out="$(psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 2>&1 <<SQL || true
begin;
$ddl
\\i $GRANT
select 'GUARD_DID_NOT_FIRE' as r;
rollback;
SQL
)"
  if printf '%s' "$out" | grep -qiE "$want"; then ok "fail-loud: $name raises"; \
  elif printf '%s' "$out" | grep -q GUARD_DID_NOT_FIRE; then no "fail-loud: $name did NOT raise"; \
  else no "fail-loud: $name inconclusive"; printf '%s\n' "$out" | sed 's/^/    /'; fi
  # confirm the real function is restored (rollback) and still (text) + granted to authenticated
  local ok_after; ok_after="$(scalar "select has_function_privilege('authenticated','public.join_pvp_room(text)','execute')")"
  [ "$ok_after" = "t" ] || no "  restore check: authenticated grant missing after '$name'"
}
faildo "missing function"      "drop function public.join_pvp_room(text);" "is missing"
faildo "wrong signature"       "drop function public.join_pvp_room(text); create function public.join_pvp_room(p_id uuid) returns void language plpgsql security definer set search_path=public as \$f\$ begin end; \$f\$;" "expected signature"
faildo "second overload"       "create function public.join_pvp_room(p_id uuid) returns void language plpgsql security definer set search_path=public as \$f\$ begin end; \$f\$;" "exactly one overload"
faildo "not SECURITY DEFINER"  "create or replace function public.join_pvp_room(p_code text) returns public.pvp_rooms language plpgsql set search_path=public as \$f\$ declare r public.pvp_rooms; begin return r; end; \$f\$;" "not SECURITY DEFINER"
faildo "no fixed search_path"  "create or replace function public.join_pvp_room(p_code text) returns public.pvp_rooms language plpgsql security definer as \$f\$ declare r public.pvp_rooms; begin return r; end; \$f\$;" "lacks a fixed search_path"

rm -f base.err g1.err g2.err
echo "== PvP migration checks: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
