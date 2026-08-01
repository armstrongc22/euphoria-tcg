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
-- service_role needs an EXPLICIT revoke, not merely the absence of a grant:
-- Supabase ships `alter default privileges in schema public grant all on
-- functions to postgres, anon, authenticated, service_role`, so the role
-- receives EXECUTE at CREATE FUNCTION time. Omitting the grant here therefore
-- left service_role executable on a real project (caught by the preview run
-- against the disposable project; an in-process PostgreSQL has no such default
-- privileges, which is why the first regression tests missed it).
--
-- Fail-loud: before touching a single grant, this asserts that EXACTLY ONE
-- public.join_pvp_room exists, that it has the expected (text) signature, and
-- that its security posture (SECURITY DEFINER + fixed search_path=public) is
-- intact. Any deviation — missing, wrong signature, multiple overloads, or an
-- unexpected definition — raises BEFORE any REVOKE/GRANT runs, so a failed
-- assertion can never leave permissions partially modified. Afterwards it
-- asserts the EFFECTIVE permission matrix and that the function itself is
-- unchanged. The REVOKE/GRANT statements are idempotent, so a successful run is
-- safely rerunnable (the postconditions hold identically on a rerun).

do $$
declare
  n_overloads int;
  fn          oid;
  is_definer  boolean;
  cfg         text[];
  owner_name  text;
  body_md5    text;
  acl         aclitem[];
  definer_now boolean;
  cfg_now     text[];
  owner_now   text;
  body_now    text;
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
  select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner), md5(p.prosrc)
    into is_definer, cfg, owner_name, body_md5
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

  -- (4) Assertions passed → apply least-privilege grants. Nothing above this
  --     line has modified a single permission, so a failed precondition always
  --     leaves the original grants exactly as they were. The function itself is
  --     left completely unchanged.
  revoke execute on function public.join_pvp_room(text) from public;
  revoke execute on function public.join_pvp_room(text) from anon;
  revoke execute on function public.join_pvp_room(text) from service_role;
  grant  execute on function public.join_pvp_room(text) to authenticated;

  -- (5) Postconditions — the EFFECTIVE permission matrix must be exactly
  --     PUBLIC=no, anon=no, authenticated=yes, service_role=no.
  --     has_function_privilege() is deliberate: it resolves privileges the way
  --     PostgreSQL actually does, including any inherited through role
  --     membership, so this cannot be satisfied by merely deleting a direct ACL
  --     entry while the role still reaches EXECUTE another way.
  select p.proacl into acl from pg_proc p where p.oid = fn;

  -- A NULL ACL is NOT "no privileges": it means the built-in default, which
  -- grants EXECUTE to PUBLIC. Treat it as world-executable and refuse.
  if acl is null then
    raise exception
      'join_pvp_room: ACL is still the built-in default (implicit EXECUTE to PUBLIC) after hardening — refusing to leave the RPC world-executable';
  end if;
  if exists (
    select 1 from aclexplode(acl) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'   -- grantee 0 = PUBLIC
  ) then
    raise exception 'join_pvp_room: PUBLIC still holds EXECUTE after hardening — refusing to complete';
  end if;
  if has_function_privilege('anon', fn, 'execute') then
    raise exception 'join_pvp_room: anon still holds EXECUTE after hardening — refusing to complete';
  end if;
  if not has_function_privilege('authenticated', fn, 'execute') then
    raise exception 'join_pvp_room: authenticated does NOT hold EXECUTE after hardening — the sole production caller would be broken';
  end if;
  if has_function_privilege('service_role', fn, 'execute') then
    raise exception
      'join_pvp_room: service_role still holds EXECUTE after hardening — Supabase default privileges grant it at CREATE time, so an explicit REVOKE is required';
  end if;

  -- (6) This migration touches permissions only: the function must be byte-for
  --     -byte the same definition, with the same owner and security posture.
  select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner), md5(p.prosrc)
    into definer_now, cfg_now, owner_now, body_now
  from pg_proc p
  where p.oid = fn;

  if definer_now is distinct from is_definer
     or cfg_now is distinct from cfg
     or owner_now is distinct from owner_name
     or body_now is distinct from body_md5 then
    raise exception 'join_pvp_room: function definition/ownership/security posture changed during grant hardening — refusing to complete';
  end if;

  raise notice 'join_pvp_room grants hardened (owner=%, security definer, search_path fixed; authenticated only — PUBLIC/anon/service_role revoked)', owner_name;
end;
$$;
