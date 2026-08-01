// @vitest-environment node
/**
 * Real-database regression tests for the fail-loud join_pvp_room grant-hardening
 * migration, run against an in-process PostgreSQL (PGlite). They prove the
 * migration asserts an exact function signature/posture before changing any
 * grant, raises clearly on every deviation, is rerunnable, and — critically —
 * leaves existing grants untouched when an assertion fails.
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

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  return db;
}
const canExec = async (db: PGlite, role: string): Promise<boolean> =>
  (
    await db.query<{ p: boolean }>(
      "select has_function_privilege($1,'public.join_pvp_room(text)','execute') p",
      [role],
    )
  ).rows[0]!.p;

describe("join_pvp_room grant-hardening — happy path (exact signature)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
    await db.exec(CORRECT);
  });

  it("hardens grants and is rerunnable", async () => {
    // Before: PUBLIC grants execute to everyone.
    expect(await canExec(db, "anon")).toBe(true);
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    await expect(db.exec(MIGRATION)).resolves.toBeDefined(); // rerun: idempotent
  });

  it("afterwards: PUBLIC/anon denied, authenticated allowed, service_role NOT granted", async () => {
    await db.exec(MIGRATION);
    expect(await canExec(db, "anon")).toBe(false);
    expect(await canExec(db, "authenticated")).toBe(true);
    expect(await canExec(db, "service_role")).toBe(false); // least privilege
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

  it("a failed assertion leaves existing grants UNCHANGED (no partial modification)", async () => {
    const db = await freshDb();
    await db.exec(WRONG_SIG); // has PUBLIC execute by default
    const before = (
      await db.query<{ p: boolean }>(
        "select has_function_privilege('anon','public.join_pvp_room(uuid)','execute') p",
      )
    ).rows[0]!.p;
    await expect(db.exec(MIGRATION)).rejects.toThrow(); // assertion fails
    const after = (
      await db.query<{ p: boolean }>(
        "select has_function_privilege('anon','public.join_pvp_room(uuid)','execute') p",
      )
    ).rows[0]!.p;
    expect(before).toBe(true);
    expect(after).toBe(true); // unchanged — the migration never reached a REVOKE
  });
});
