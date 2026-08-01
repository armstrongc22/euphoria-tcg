-- ============================================================================
-- Harden execute grants on public.join_pvp_room(text)
-- ============================================================================
-- join_pvp_room is the only sanctioned way to seat player_two: a SECURITY
-- DEFINER RPC gated by an internal auth.uid() check. PostgreSQL grants EXECUTE
-- to PUBLIC by default, so the anon role could invoke it (it exited immediately
-- at the auth.uid() guard — no data was exposed). This migration removes
-- PUBLIC/anon EXECUTE and keeps only `authenticated`, the sole production
-- caller: the beta invokes the RPC exclusively on an authenticated session
-- (packages/core/src/pvp.ts), behind a login gate. There is NO service_role
-- call site, so — for least privilege — service_role is deliberately NOT
-- granted execute here.
--
-- Fail-loud: before touching a single grant, this asserts that EXACTLY ONE
-- public.join_pvp_room exists, that it has the expected (text) signature, and
-- that its security posture (SECURITY DEFINER + fixed search_path=public) is
-- intact. Any deviation — missing, wrong signature, multiple overloads, or an
-- unexpected definition — raises BEFORE any REVOKE/GRANT runs, so a failed
-- assertion can never leave permissions partially modified. The REVOKE/GRANT
-- statements are idempotent, so a successful run is safely rerunnable.

do $$
declare
  n_overloads int;
  fn          oid;
  is_definer  boolean;
  cfg         text[];
  owner_name  text;
begin
  -- (1) Exactly one public.join_pvp_room must exist.
  select count(*) into n_overloads
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'join_pvp_room';

  if n_overloads = 0 then
    raise exception
      'join_pvp_room: function public.join_pvp_room is missing — apply the PvP schema migration (20260702120000) before this one';
  elsif n_overloads > 1 then
    raise exception
      'join_pvp_room: expected exactly one overload but found % — refusing to harden an ambiguous function set', n_overloads;
  end if;

  -- (2) The sole overload must match the expected identity signature exactly.
  --     to_regprocedure(...(text)) resolves only if a (text) overload exists,
  --     and (1) guarantees it is the only one — so this pins the exact signature
  --     without depending on version-specific identity-argument formatting.
  fn := to_regprocedure('public.join_pvp_room(text)');
  if fn is null then
    raise exception
      'join_pvp_room: the sole overload does not match the expected signature public.join_pvp_room(text) — refusing to harden';
  end if;

  -- (3) Security posture must be preserved (this migration must never turn a
  --     hardened DEFINER RPC into something unexpected).
  select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)
    into is_definer, cfg, owner_name
  from pg_proc p
  where p.oid = fn;

  if not is_definer then
    raise exception
      'join_pvp_room: function is not SECURITY DEFINER — unexpected definition, refusing to change grants';
  end if;
  if cfg is null or not (cfg @> array['search_path=public']) then
    raise exception
      'join_pvp_room: SECURITY DEFINER function lacks a fixed search_path=public — refusing to harden';
  end if;

  -- (4) Assertions passed → apply least-privilege grants. The function itself is
  --     left completely unchanged. No service_role grant (no such call site).
  revoke execute on function public.join_pvp_room(text) from public;
  revoke execute on function public.join_pvp_room(text) from anon;
  grant  execute on function public.join_pvp_room(text) to authenticated;

  raise notice 'join_pvp_room grants hardened (owner=%, security definer, search_path fixed; authenticated only)', owner_name;
end;
$$;
