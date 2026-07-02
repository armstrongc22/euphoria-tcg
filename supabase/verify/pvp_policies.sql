-- ============================================================================
-- Verification: PvP schema is fully applied
-- ============================================================================
-- Read-only. Run in the Supabase SQL Editor (or psql) after applying
-- migrations. Expected results are noted at each step.

-- 1. Both tables exist (expect 2 rows: pvp_matches, pvp_rooms).
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('pvp_rooms', 'pvp_matches')
order by table_name;

-- 2. RLS is enabled on both (expect relrowsecurity = true for both rows).
select relname, relrowsecurity
from pg_class
where relname in ('pvp_rooms', 'pvp_matches')
order by relname;

-- 3. All six policies exist (expect exactly these rows):
--      pvp_matches | pvp_matches_insert | INSERT
--      pvp_matches | pvp_matches_select | SELECT
--      pvp_matches | pvp_matches_update | UPDATE
--      pvp_rooms   | pvp_rooms_insert   | INSERT
--      pvp_rooms   | pvp_rooms_select   | SELECT
--      pvp_rooms   | pvp_rooms_update   | UPDATE
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('pvp_rooms', 'pvp_matches')
order by tablename, policyname;

-- 4. The join RPC exists and is SECURITY DEFINER (expect 1 row, prosecdef = true).
select proname, prosecdef
from pg_proc
where proname = 'join_pvp_room';

-- 5. Optional: realtime publication membership (0–2 rows; the app polls as a
--    fallback, so missing rows here only mean slower lobby updates).
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('pvp_rooms', 'pvp_matches')
order by tablename;

-- 6. Migration bookkeeping. The tracking table exists only once
--    `supabase db push` has run at least once (NULL means the schema was
--    applied by hand in the SQL editor; this query itself never errors).
select to_regclass('supabase_migrations.schema_migrations') as migrations_table;
-- If the result is non-null, list the applied migrations with:
--   select version, name from supabase_migrations.schema_migrations order by version;
