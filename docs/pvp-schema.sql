-- ============================================================================
-- Euphoria TCG — 1v1 private-invite PvP schema (Phase 1: lobby; Phase 2: match)
-- ============================================================================
-- Run this in the Supabase SQL editor (or via the CLI) on the beta project.
-- It ONLY adds new objects (pvp_rooms, pvp_matches, join_pvp_room RPC) and does
-- NOT touch the protected tables (profiles, match_history, owned_cards,
-- reward_events, active_decks, feedback_reports). Safe to run once; re-running
-- is guarded with IF NOT EXISTS / CREATE OR REPLACE where possible.
--
-- Security summary:
--  * Only authenticated users can create rooms.
--  * RLS restricts SELECT/UPDATE on a room to its participants — non-members
--    can NOT read the rooms table (so codes can't be enumerated).
--  * Joining goes through join_pvp_room(code), a SECURITY DEFINER function that
--    validates the room server-side and seats the caller as player_two.
--  * PvP grants NO rewards (this schema has no reward/ownership side effects).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.pvp_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  player_one uuid not null references auth.users (id) on delete cascade,
  player_two uuid references auth.users (id) on delete set null,
  player_one_ready boolean not null default false,
  player_two_ready boolean not null default false,
  player_one_deck jsonb,
  player_two_deck jsonb,
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'active', 'completed', 'abandoned')),
  match_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists pvp_rooms_room_code_idx on public.pvp_rooms (room_code);
create index if not exists pvp_rooms_participants_idx
  on public.pvp_rooms (player_one, player_two);

-- Phase 2 (created now so the FK + RLS exist; unused until live sync lands).
create table if not exists public.pvp_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.pvp_rooms (id) on delete cascade,
  player_one uuid not null references auth.users (id) on delete cascade,
  player_two uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  player_one_deck jsonb,
  player_two_deck jsonb,
  current_player uuid,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  action_log jsonb not null default '[]'::jsonb,
  version integer not null default 0,          -- optimistic concurrency
  winner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pvp_rooms_touch on public.pvp_rooms;
create trigger pvp_rooms_touch before update on public.pvp_rooms
  for each row execute function public.touch_updated_at();

drop trigger if exists pvp_matches_touch on public.pvp_matches;
create trigger pvp_matches_touch before update on public.pvp_matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.pvp_rooms enable row level security;
alter table public.pvp_matches enable row level security;

-- Rooms: only participants may read.
drop policy if exists pvp_rooms_select on public.pvp_rooms;
create policy pvp_rooms_select on public.pvp_rooms
  for select to authenticated
  using (auth.uid() in (created_by, player_one, player_two));

-- Rooms: an authenticated user may create a room they own (as player_one).
drop policy if exists pvp_rooms_insert on public.pvp_rooms;
create policy pvp_rooms_insert on public.pvp_rooms
  for insert to authenticated
  with check (auth.uid() = created_by and auth.uid() = player_one);

-- Rooms: participants may update (ready flags, decks, leave). Joining is NOT
-- done here (a non-member can't SELECT the row) — it goes through the RPC below.
drop policy if exists pvp_rooms_update on public.pvp_rooms;
create policy pvp_rooms_update on public.pvp_rooms
  for update to authenticated
  using (auth.uid() in (created_by, player_one, player_two))
  with check (auth.uid() in (created_by, player_one, player_two));

-- Matches: only the two participants may read/update.
drop policy if exists pvp_matches_select on public.pvp_matches;
create policy pvp_matches_select on public.pvp_matches
  for select to authenticated
  using (auth.uid() in (player_one, player_two));

drop policy if exists pvp_matches_update on public.pvp_matches;
create policy pvp_matches_update on public.pvp_matches
  for update to authenticated
  using (auth.uid() in (player_one, player_two))
  with check (auth.uid() in (player_one, player_two));

-- ---------------------------------------------------------------------------
-- join_pvp_room(code) — SECURITY DEFINER so a non-member can seat themselves as
-- player_two without ever being able to SELECT/enumerate the rooms table.
-- Validates: room exists, not expired, still waiting, not the caller's own
-- room, not already full. Idempotent for the existing player_two (reload-safe).
-- ---------------------------------------------------------------------------
create or replace function public.join_pvp_room(p_code text)
returns public.pvp_rooms
language plpgsql security definer set search_path = public as $$
declare
  r public.pvp_rooms;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into r from public.pvp_rooms where room_code = p_code for update;

  if not found then
    raise exception 'room not found';
  end if;
  if r.player_two = uid then
    return r; -- rejoin (e.g. after a reload)
  end if;
  if r.expires_at <= now() then
    raise exception 'room expired';
  end if;
  if r.player_one = uid then
    raise exception 'cannot join your own room';
  end if;
  if r.player_two is not null then
    raise exception 'room full';
  end if;
  if r.status <> 'waiting' then
    raise exception 'room not open';
  end if;

  update public.pvp_rooms
     set player_two = uid
   where id = r.id
  returning * into r;

  return r;
end;
$$;

grant execute on function public.join_pvp_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (optional but recommended): stream row changes to the lobby.
-- If this errors because the publication doesn't exist on your project, skip it
-- — the client has a polling fallback.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.pvp_rooms;
alter publication supabase_realtime add table public.pvp_matches;

-- ============================================================================
-- Phase 2 addendum — live-match sync (run this section too; safe to re-run)
-- ============================================================================
-- Phase 1 shipped pvp_matches with SELECT/UPDATE policies but NO INSERT policy,
-- so nobody could create a match row. Phase 2 adds it: only the room's creator
-- (who is always seat player_one) may create the match, and only for a room
-- they actually own. The client writes seed + both published decks + an empty
-- action_log; from then on gameplay is UPDATE-only (action_log/version/status),
-- already covered by pvp_matches_update.
--
-- Sync contract (enforced client-side, documented here): a match is ONE
-- canonical deterministic game — seed + both decks + ordered action_log; only
-- the active player appends, guarded by the optimistic `version` column. PvP
-- still grants NO rewards and never touches the protected tables.
drop policy if exists pvp_matches_insert on public.pvp_matches;
create policy pvp_matches_insert on public.pvp_matches
  for insert to authenticated
  with check (
    auth.uid() = player_one
    and exists (
      select 1 from public.pvp_rooms r
      where r.id = room_id
        and r.created_by = auth.uid()
        and r.player_one = player_one
        and r.player_two = player_two
    )
  );
