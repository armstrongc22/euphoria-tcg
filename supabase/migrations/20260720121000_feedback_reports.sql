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
-- Idempotent throughout (create if not exists / drop policy if exists).

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

create index if not exists feedback_reports_user_created_idx
  on public.feedback_reports (user_id, created_at desc);

alter table public.feedback_reports enable row level security;

-- Users may insert only their own reports.
drop policy if exists feedback_reports_insert on public.feedback_reports;
create policy feedback_reports_insert on public.feedback_reports
  for insert to authenticated
  with check (user_id = auth.uid());

-- Users may read back only their own reports (never anyone else's). There are
-- deliberately no UPDATE or DELETE policies, and no anon/public access at all.
drop policy if exists feedback_reports_select on public.feedback_reports;
create policy feedback_reports_select on public.feedback_reports
  for select to authenticated
  using (user_id = auth.uid());
