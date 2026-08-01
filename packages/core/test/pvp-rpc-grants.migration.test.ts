// @vitest-environment node
/**
 * Real-database regression tests for the fail-loud join_pvp_room grant-hardening
 * migration, run against an in-process PostgreSQL (PGlite). They prove the
 * migration asserts an exact function signature/posture before changing any
 * grant, raises clearly on every deviation, is rerunnable, and — critically —
 * leaves existing grants untouched when an assertion fails.
 *
 * The harness reproduces SUPABASE-STYLE DEFAULT PRIVILEGES:
 *
 *     alter default privileges in schema public
 *       grant all on functions to postgres, anon, authenticated, service_role;
 *
 * Supabase ships this, so every function created afterwards starts with EXECUTE
 * for service_role (and anon) on top of PostgreSQL's built-in EXECUTE-to-PUBLIC.
 * The original harness omitted it, so `service_role` never held EXECUTE here and
 * the tests passed while the real project failed — the preview run against the
 * disposable project caught it. Omitting a grant is not the same as revoking one.
 *
 * The migration only touches GRANTs, so the harness installs a minimal
 * SECURITY DEFINER `join_pvp_room(text)` (return type is irrelevant to grants)
 * plus the Supabase-like roles.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260720120000_join_pvp_room_grants.sql",
  ),
  "utf8",
);

/** Function variants used to exercise the assertions. */
const CORRECT =
  "create function public.join_pvp_room(p_code text) returns void " +
  "language plpgsql security definer set search_path = public as $fn$ begin end; $fn$;";
const WRONG_SIG =
  "create function public.join_pvp_room(p_id uuid) returns void " +
  "language plpgsql security definer set search_path = public as $fn$ begin end; $fn$;";
const NOT_DEFINER =
  "create function public.join_pvp_room(p_code text) returns void " +
  "language plpgsql set search_path = public as $fn$ begin end; $fn$;";
const NO_SEARCH_PATH =
  "create function public.join_pvp_room(p_code text) returns void " +
  "language plpgsql security definer as $fn$ begin end; $fn$;";

const TEXT_SIG = "public.join_pvp_room(text)";
const UUID_SIG = "public.join_pvp_room(uuid)";

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase's default privileges: functions created afterwards are executable
    -- by these roles without any explicit GRANT in our migrations.
    alter default privileges in schema public
      grant all on functions to postgres, anon, authenticated, service_role;
  `);
  return db;
}

const canExec = async (db: PGlite, role: string, sig = TEXT_SIG): Promise<boolean> =>
  (await db.query<{ p: boolean }>("select has_function_privilege($1,$2,'execute') p", [role, sig])).rows[0]!.p;

/**
 * Whether PUBLIC holds EXECUTE. A NULL proacl is not "no privileges" — it is
 * PostgreSQL's built-in default, which grants EXECUTE to PUBLIC.
 */
const publicCanExec = async (db: PGlite, sig = TEXT_SIG): Promise<boolean> =>
  (
    await db.query<{ p: boolean }>(
      `select case when p.proacl is null then true
                   else exists (select 1 from aclexplode(p.proacl) a
                                where a.grantee = 0 and a.privilege_type = 'EXECUTE')
              end p
       from pg_proc p where p.oid = $1::regprocedure`,
      [sig],
    )
  ).rows[0]!.p;

/** The full effective permission matrix for a signature. */
async function matrix(db: PGlite, sig = TEXT_SIG) {
  return {
    PUBLIC: await publicCanExec(db, sig),
    anon: await canExec(db, "anon", sig),
    authenticated: await canExec(db, "authenticated", sig),
    service_role: await canExec(db, "service_role", sig),
  };
}

/** Definition + posture fingerprint, to prove the migration changes neither. */
async function fingerprint(db: PGlite, sig = TEXT_SIG) {
  return (
    await db.query<{ body: string; definer: boolean; cfg: string[] | null; owner: string }>(
      `select md5(p.prosrc) body, p.prosecdef definer, p.proconfig cfg, pg_get_userbyid(p.proowner) owner
       from pg_proc p where p.oid = $1::regprocedure`,
      [sig],
    )
  ).rows[0]!;
}

describe("join_pvp_room grant-hardening — Supabase-style starting state", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
    await db.exec(CORRECT);
  });

  it("service_role BEGINS with EXECUTE (Supabase default privileges), as do PUBLIC and anon", async () => {
    expect(await matrix(db)).toEqual({
      PUBLIC: true,
      anon: true,
      authenticated: true,
      service_role: true, // the defect: no grant was ever written, yet it holds EXECUTE
    });
  });

  it("the migration explicitly removes service_role's EXECUTE", async () => {
    expect(await canExec(db, "service_role")).toBe(true);
    await db.exec(MIGRATION);
    expect(await canExec(db, "service_role")).toBe(false);
  });

  it("produces exactly the intended matrix: PUBLIC/anon/service_role denied, authenticated allowed", async () => {
    await db.exec(MIGRATION);
    expect(await matrix(db)).toEqual({
      PUBLIC: false,
      anon: false,
      authenticated: true,
      service_role: false,
    });
  });

  it("is idempotent: a second run keeps service_role denied and authenticated allowed", async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    expect(await matrix(db)).toEqual({
      PUBLIC: false,
      anon: false,
      authenticated: true,
      service_role: false,
    });
  });

  it("leaves the function body, owner and security posture unchanged", async () => {
    const before = await fingerprint(db);
    await db.exec(MIGRATION);
    const after = await fingerprint(db);
    expect(after).toEqual(before);
    expect(after.definer).toBe(true);
    expect(after.cfg).toEqual(["search_path=public"]);
  });
});

describe("join_pvp_room grant-hardening — postconditions check EFFECTIVE privileges", () => {
  it("raises when service_role reaches EXECUTE through role membership, not a direct ACL entry", async () => {
    const db = await freshDb();
    await db.exec(CORRECT);
    // service_role inherits everything granted to authenticated. Revoking
    // service_role's own ACL entry is then NOT enough — the effective privilege
    // survives. Only a check that resolves inheritance catches this.
    await db.exec("grant authenticated to service_role;");
    await expect(db.exec(MIGRATION)).rejects.toThrow(/service_role still holds EXECUTE after hardening/i);
  });

  it("that failure rolls back, leaving the original grants unchanged", async () => {
    const db = await freshDb();
    await db.exec(CORRECT);
    await db.exec("grant authenticated to service_role;");
    const before = await matrix(db);
    await expect(db.exec(MIGRATION)).rejects.toThrow();
    expect(await matrix(db)).toEqual(before);
  });
});

describe("join_pvp_room grant-hardening — fail-loud assertions", () => {
  it("raises when the function is missing", async () => {
    const db = await freshDb(); // no function installed
    await expect(db.exec(MIGRATION)).rejects.toThrow(/is missing/i);
  });

  it("raises on a wrong signature (single non-text overload)", async () => {
    const db = await freshDb();
    await db.exec(WRONG_SIG);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/expected signature public\.join_pvp_room\(text\)/i);
  });

  it("raises when multiple overloads exist", async () => {
    const db = await freshDb();
    await db.exec(CORRECT);
    await db.exec(WRONG_SIG); // now two overloads
    await expect(db.exec(MIGRATION)).rejects.toThrow(/exactly one overload but found 2/i);
  });

  it("raises when the function is not SECURITY DEFINER", async () => {
    const db = await freshDb();
    await db.exec(NOT_DEFINER);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/not SECURITY DEFINER/i);
  });

  it("raises when a SECURITY DEFINER function lacks a fixed search_path", async () => {
    const db = await freshDb();
    await db.exec(NO_SEARCH_PATH);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/lacks a fixed search_path/i);
  });
});

describe("join_pvp_room grant-hardening — a failed precondition never changes a grant", () => {
  /** Every precondition failure, with the signature(s) whose grants must survive. */
  const CASES: Array<{ name: string; setup: string[]; sigs: string[] }> = [
    { name: "wrong signature", setup: [WRONG_SIG], sigs: [UUID_SIG] },
    { name: "multiple overloads", setup: [CORRECT, WRONG_SIG], sigs: [TEXT_SIG, UUID_SIG] },
    { name: "not SECURITY DEFINER", setup: [NOT_DEFINER], sigs: [TEXT_SIG] },
    { name: "no fixed search_path", setup: [NO_SEARCH_PATH], sigs: [TEXT_SIG] },
  ];

  it.each(CASES)("$name: all original grants survive untouched", async ({ setup, sigs }) => {
    const db = await freshDb();
    for (const stmt of setup) await db.exec(stmt);

    const before = Object.fromEntries(await Promise.all(sigs.map(async (s) => [s, await matrix(db, s)])));
    // Every role starts executable under Supabase-style defaults — so a partial
    // modification would be visible as a flipped value below.
    for (const sig of sigs) {
      expect(before[sig]).toEqual({ PUBLIC: true, anon: true, authenticated: true, service_role: true });
    }

    await expect(db.exec(MIGRATION)).rejects.toThrow();

    const after = Object.fromEntries(await Promise.all(sigs.map(async (s) => [s, await matrix(db, s)])));
    expect(after).toEqual(before);
  });

  it("the missing-function case cannot modify anything (no function exists)", async () => {
    const db = await freshDb();
    await expect(db.exec(MIGRATION)).rejects.toThrow(/is missing/i);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace " +
        "where ns.nspname = 'public' and p.proname = 'join_pvp_room'",
    );
    expect(rows[0]!.n).toBe(0);
  });
});
