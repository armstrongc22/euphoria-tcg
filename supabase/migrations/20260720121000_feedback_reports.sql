-- ============================================================================
-- feedback_reports: beta feedback / bug reports (deliberate, planned task —
-- this table is on the ENGINE_LOCK §4 protected list and this migration is
-- its sanctioned creation).
-- ============================================================================
-- The app has inserted into this table since the feedback feature shipped, but
-- the table was never created in the live database, so every report fell back
-- to the client's localStorage pending queue. This migration creates the table
-- with ownership defaults, length constraints, and an idempotency key so those
-- queued reports can flush without ever double-inserting.
--
-- Access is least-privilege: the client only INSERTs (no returned
-- representation), so authenticated is granted INSERT only — never
-- SELECT/UPDATE/DELETE — and anon gets nothing. Retrieval is service_role-only
-- (it bypasses RLS) via an approved administrative backend.
--
-- Idempotent throughout (create if not exists / drop policy if exists / revoke
-- + grant are safe to re-run), with an explicit stale-schema guard so a
-- pre-existing incompatible table fails loudly instead of appearing to succeed.

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated idempotency key: one per submission, reused across
  -- retries of the same queued report, so a retry can never duplicate a row.
  client_key uuid not null unique,
  -- Ownership. NOT NULL + default auth.uid(): a report always belongs to the
  -- signed-in reporter, and the client may simply omit the column.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text check (email is null or char_length(email) <= 320),
  type text not null check (
    type in ('bug', 'confusing-ux', 'balance', 'card-issue', 'mobile', 'general')
  ),
  message text not null check (char_length(message) between 1 and 5000),
  view text check (view is null or char_length(view) <= 100),
  build text check (build is null or char_length(build) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  mobile boolean not null default false,
  selected_faction text check (
    selected_faction is null or char_length(selected_faction) <= 40
  ),
  -- Compact context blob (onboarding/match/reward/debug summary); the client
  -- caps debug events at 25, the DB caps the stored size outright.
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 32768),
  created_at timestamptz not null default now()
);

-- Stale-schema guard: `create table if not exists` silently skips a pre-existing
-- table, which could be an incompatible one (e.g. the old README SQL that had a
-- NULLABLE user_id and no client_key). Assert the critical invariants so such a
-- table makes THIS migration fail loudly — deployment must not appear to
-- succeed against a schema that the app's inserts would then break on.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback_reports'
      and column_name = 'client_key'
  ) then
    raise exception
      'feedback_reports exists without a client_key column — incompatible pre-existing schema; reconcile it manually before deploying (idempotency + de-dup depend on client_key).';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback_reports'
      and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    raise exception
      'feedback_reports.user_id is NULLABLE — incompatible pre-existing schema; expected NOT NULL DEFAULT auth.uid() so ownership/RLS cannot be bypassed.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'feedback_reports'
      and c.contype = 'u'
      and c.conkey = array[
        (select attnum from pg_attribute
         where attrelid = t.oid and attname = 'client_key' and not attisdropped)
      ]
  ) then
    raise exception
      'feedback_reports.client_key lacks a UNIQUE constraint — incompatible pre-existing schema; the idempotency guarantee depends on it.';
  end if;
end $$;

create index if not exists feedback_reports_user_created_idx
  on public.feedback_reports (user_id, created_at desc);

alter table public.feedback_reports enable row level security;

-- ---------------------------------------------------------------------------
-- Least-privilege grants. Supabase grants anon/authenticated broad table
-- privileges by default; strip them and re-grant only what the client needs
-- (INSERT for authenticated). service_role is left untouched — it keeps full
-- access and bypasses RLS for the approved administrative retrieval path.
-- ---------------------------------------------------------------------------
revoke all on public.feedback_reports from public;
revoke all on public.feedback_reports from anon;
revoke all on public.feedback_reports from authenticated;
grant insert on public.feedback_reports to authenticated;

-- Insert policy: a user may insert only rows owned by their own auth.uid().
-- Combined with the NOT NULL DEFAULT auth.uid() column, a client-supplied
-- user_id that differs from the caller's id is rejected — no ID spoofing.
drop policy if exists feedback_reports_insert on public.feedback_reports;
create policy feedback_reports_insert on public.feedback_reports
  for insert to authenticated
  with check (user_id = auth.uid());

-- No SELECT/UPDATE/DELETE policies exist, and (with the grants above) no table
-- privilege for them either — so authenticated users cannot read, edit, or
-- delete any report, their own or others'. Retrieval is service_role-only.
-- Drop the read policy from the earlier revision of this migration, if present.
drop policy if exists feedback_reports_select on public.feedback_reports;
