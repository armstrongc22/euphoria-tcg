-- ============================================================================
-- feedback_reports schema / RLS / grants verification (read-only, PASS/FAIL).
-- Run against a DISPOSABLE Supabase branch AFTER the migration is applied:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f schema-checks.sql
-- or paste into the Supabase SQL Editor. Prints no credentials or data rows.
-- ============================================================================
\pset format aligned
\pset border 2

with checks(ord, check_name, status, detail) as (
  -- 1. Table + ownership + RLS ------------------------------------------------
  select 1, 'table public.feedback_reports exists',
    case when to_regclass('public.feedback_reports') is not null then 'PASS' else 'FAIL' end,
    coalesce((select 'owner=' || pg_get_userbyid(relowner)
              from pg_class where oid = 'public.feedback_reports'::regclass), 'missing')
  union all
  select 2, 'row level security is enabled',
    case when (select relrowsecurity from pg_class where oid='public.feedback_reports'::regclass)
         then 'PASS' else 'FAIL' end, ''
  -- 2. Columns present (exact set) -------------------------------------------
  union all
  select 3, 'has the expected 13 columns',
    case when (select count(*) from information_schema.columns
               where table_schema='public' and table_name='feedback_reports') = 13
         then 'PASS' else 'FAIL' end,
    (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns
     where table_schema='public' and table_name='feedback_reports')
  -- 3. client_key: NOT NULL + UNIQUE -----------------------------------------
  union all
  select 4, 'client_key is NOT NULL',
    case when (select is_nullable from information_schema.columns
               where table_schema='public' and table_name='feedback_reports'
                 and column_name='client_key') = 'NO' then 'PASS' else 'FAIL' end, ''
  union all
  select 5, 'client_key has a UNIQUE constraint',
    case when exists (
      select 1 from pg_constraint c
      where c.conrelid='public.feedback_reports'::regclass and c.contype='u'
        and c.conkey = array[(select attnum from pg_attribute
                              where attrelid='public.feedback_reports'::regclass
                                and attname='client_key' and not attisdropped)]
    ) then 'PASS' else 'FAIL' end, ''
  -- 4. user_id: NOT NULL + default auth.uid() + FK ON DELETE CASCADE ---------
  union all
  select 6, 'user_id is NOT NULL',
    case when (select is_nullable from information_schema.columns
               where table_schema='public' and table_name='feedback_reports'
                 and column_name='user_id') = 'NO' then 'PASS' else 'FAIL' end, ''
  union all
  select 7, 'user_id default is auth.uid()',
    case when (select column_default from information_schema.columns
               where table_schema='public' and table_name='feedback_reports'
                 and column_name='user_id') ilike '%auth.uid()%' then 'PASS' else 'FAIL' end,
    coalesce((select column_default from information_schema.columns
              where table_schema='public' and table_name='feedback_reports'
                and column_name='user_id'), '')
  union all
  select 8, 'user_id FK references auth.users ON DELETE CASCADE',
    case when exists (
      select 1 from pg_constraint c
      where c.conrelid='public.feedback_reports'::regclass and c.contype='f'
        and c.confrelid='auth.users'::regclass and c.confdeltype='c'
    ) then 'PASS' else 'FAIL' end, ''
  -- 5. CHECK constraints (message length, type enum, context size) -----------
  union all
  select 9, 'message length CHECK (1..5000) present',
    case when exists (select 1 from pg_constraint
      where conrelid='public.feedback_reports'::regclass and contype='c'
        and pg_get_constraintdef(oid) ilike '%char_length(message)%5000%')
      then 'PASS' else 'FAIL' end, ''
  union all
  select 10, 'type enum CHECK present',
    case when exists (select 1 from pg_constraint
      where conrelid='public.feedback_reports'::regclass and contype='c'
        and pg_get_constraintdef(oid) ilike '%type%bug%general%')
      then 'PASS' else 'FAIL' end, ''
  union all
  select 11, 'context size CHECK (<= 32768) present',
    case when exists (select 1 from pg_constraint
      where conrelid='public.feedback_reports'::regclass and contype='c'
        and pg_get_constraintdef(oid) ilike '%pg_column_size(context)%32768%')
      then 'PASS' else 'FAIL' end, ''
  -- 6. Index -----------------------------------------------------------------
  union all
  select 12, 'index feedback_reports_user_created_idx exists',
    case when exists (select 1 from pg_indexes
      where schemaname='public' and tablename='feedback_reports'
        and indexname='feedback_reports_user_created_idx')
      then 'PASS' else 'FAIL' end, ''
  -- 7. Policies: exactly one INSERT policy, no read/write policies ------------
  union all
  select 13, 'exactly one policy exists (the INSERT policy)',
    case when (select count(*) from pg_policies
               where schemaname='public' and tablename='feedback_reports') = 1
      then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(policyname || ':' || cmd, ', ')
              from pg_policies where schemaname='public' and tablename='feedback_reports'), 'none')
  union all
  select 14, 'the policy is INSERT for authenticated with user_id = auth.uid()',
    case when exists (select 1 from pg_policies
      where schemaname='public' and tablename='feedback_reports'
        and cmd='INSERT' and 'authenticated' = any(roles)
        and with_check ilike '%auth.uid()%') then 'PASS' else 'FAIL' end, ''
  union all
  select 15, 'no SELECT/UPDATE/DELETE policies exist',
    case when not exists (select 1 from pg_policies
      where schemaname='public' and tablename='feedback_reports'
        and cmd in ('SELECT','UPDATE','DELETE','ALL')) then 'PASS' else 'FAIL' end, ''
  -- 8. Grants: least privilege ------------------------------------------------
  union all
  select 16, 'authenticated has INSERT',
    case when has_table_privilege('authenticated','public.feedback_reports','INSERT')
      then 'PASS' else 'FAIL' end, ''
  union all
  select 17, 'authenticated does NOT have SELECT/UPDATE/DELETE',
    case when not has_table_privilege('authenticated','public.feedback_reports','SELECT')
          and not has_table_privilege('authenticated','public.feedback_reports','UPDATE')
          and not has_table_privilege('authenticated','public.feedback_reports','DELETE')
      then 'PASS' else 'FAIL' end, ''
  union all
  select 18, 'anon has NO table privileges',
    case when not has_table_privilege('anon','public.feedback_reports','INSERT')
          and not has_table_privilege('anon','public.feedback_reports','SELECT')
          and not has_table_privilege('anon','public.feedback_reports','UPDATE')
          and not has_table_privilege('anon','public.feedback_reports','DELETE')
      then 'PASS' else 'FAIL' end, ''
  union all
  select 19, 'service_role can SELECT (admin retrieval)',
    case when has_table_privilege('service_role','public.feedback_reports','SELECT')
      then 'PASS' else 'FAIL' end, ''
),
summary(ord, check_name, status, detail) as (
  select 100, 'SUMMARY',
    case when count(*) filter (where status <> 'PASS') = 0
         then 'ALL PASS' else count(*) filter (where status <> 'PASS')::text || ' FAILED' end,
    count(*)::text || ' checks total'
  from checks
)
select check_name, status, detail
from (select * from checks union all select * from summary) rows
order by ord;
