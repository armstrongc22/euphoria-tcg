-- ============================================================================
-- Harden execute grants on public.join_pvp_room(text)
-- ============================================================================
-- PostgreSQL grants EXECUTE on functions to PUBLIC by default, so the anon
-- role could invoke the RPC (it exited immediately at the internal
-- `auth.uid() is null` guard — no data was exposed; this is defense-in-depth).
-- The beta client only calls the RPC on an authenticated session, so revoking
-- anonymous execution changes nothing for legitimate users.
--
-- Idempotent: REVOKE/GRANT are safe to re-run; the DO block only guards
-- against the function not existing yet (fresh databases apply the PvP schema
-- migration first, so this is belt-and-braces).

do $$
begin
  if to_regprocedure('public.join_pvp_room(text)') is not null then
    revoke execute on function public.join_pvp_room(text) from public;
    revoke execute on function public.join_pvp_room(text) from anon;
    grant execute on function public.join_pvp_room(text) to authenticated;
    -- Revoking PUBLIC also strips service_role's implicit access; re-grant it
    -- so dashboard/API testing and any future server-side caller keep working.
    grant execute on function public.join_pvp_room(text) to service_role;
  end if;
end;
$$;
