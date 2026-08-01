// @vitest-environment node
/**
 * Migration ordering regression tests.
 *
 * `supabase db push` refuses to apply a migration whose version sorts BEFORE
 * the last version already recorded on the remote. The join_pvp_room grant
 * migration originally shipped as 20260720120000, ten minutes earlier than
 * 20260720121000_feedback_reports which was already applied to production — so
 * the production push failed without applying anything, and the file had to be
 * re-dated to 20260801153000.
 *
 * These tests are about FILENAMES AND ORDERING ONLY. They deliberately do not
 * execute any SQL — the migration's behaviour is covered by
 * pvp-rpc-grants.migration.test.ts against a real PostgreSQL. The last case here
 * only asserts that the re-dated file still CONTAINS the reviewed assertions,
 * proving the rename did not quietly alter the verified SQL.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

/** The version already applied to production that we must sort after. */
const FEEDBACK_VERSION = "20260720121000";
/** The re-dated PvP grant migration. */
const PVP_GRANTS_VERSION = "20260801153000";

const FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const versionOf = (file: string): string => file.split("_")[0]!;

describe("migration filenames and ordering", () => {
  it("every migration filename starts with a 14-digit version", () => {
    for (const file of FILES) expect(file, file).toMatch(/^\d{14}_/);
  });

  it("migration versions are unique", () => {
    const versions = FILES.map(versionOf);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("migration filenames are unique", () => {
    expect(new Set(FILES).size).toBe(FILES.length);
  });

  it("exactly one join_pvp_room_grants migration exists, at the re-dated version", () => {
    const grants = FILES.filter((f) => f.includes("join_pvp_room_grants"));
    expect(grants).toEqual([`${PVP_GRANTS_VERSION}_join_pvp_room_grants.sql`]);
  });

  it("the old 20260720120000 version is gone", () => {
    expect(FILES.some((f) => f.startsWith("20260720120000"))).toBe(false);
  });

  it("the PvP grant migration sorts AFTER the already-applied feedback migration", () => {
    expect(FILES.some((f) => versionOf(f) === FEEDBACK_VERSION)).toBe(true);
    expect(PVP_GRANTS_VERSION > FEEDBACK_VERSION).toBe(true);
    expect(Number(PVP_GRANTS_VERSION)).toBeGreaterThan(Number(FEEDBACK_VERSION));
    // And in the order the CLI actually applies them (lexicographic by filename).
    const order = FILES.map(versionOf);
    expect(order.indexOf(PVP_GRANTS_VERSION)).toBeGreaterThan(order.indexOf(FEEDBACK_VERSION));
    expect(order.indexOf(PVP_GRANTS_VERSION)).toBe(order.length - 1);
  });
});

describe("the re-dated migration still contains the reviewed SQL", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${PVP_GRANTS_VERSION}_join_pvp_room_grants.sql`), "utf8");

  it("keeps every fail-loud precondition", () => {
    expect(sql).toMatch(/is missing — apply the PvP schema migration/i);
    expect(sql).toMatch(/expected exactly one overload but found/i);
    expect(sql).toMatch(/does not match the expected signature public\.join_pvp_room\(text\)/i);
    expect(sql).toMatch(/is not SECURITY DEFINER/i);
    expect(sql).toMatch(/lacks a fixed search_path=public/i);
  });

  it("keeps the four-role grant statements in order", () => {
    const revokePublic = sql.indexOf("revoke execute on function public.join_pvp_room(text) from public;");
    const revokeAnon = sql.indexOf("revoke execute on function public.join_pvp_room(text) from anon;");
    const revokeService = sql.indexOf("revoke execute on function public.join_pvp_room(text) from service_role;");
    const grantAuth = sql.indexOf("grant  execute on function public.join_pvp_room(text) to authenticated;");
    for (const idx of [revokePublic, revokeAnon, revokeService, grantAuth]) expect(idx).toBeGreaterThan(-1);
    expect(revokeAnon).toBeGreaterThan(revokePublic);
    expect(revokeService).toBeGreaterThan(revokeAnon);
    expect(grantAuth).toBeGreaterThan(revokeService);
  });

  it("keeps the final four-role postconditions", () => {
    expect(sql).toMatch(/PUBLIC still holds EXECUTE after hardening/i);
    expect(sql).toMatch(/anon still holds EXECUTE after hardening/i);
    expect(sql).toMatch(/authenticated does NOT hold EXECUTE after hardening/i);
    expect(sql).toMatch(/service_role still holds EXECUTE after hardening/i);
    expect(sql).toMatch(/ACL is still the built-in default/i);
    expect(sql).toMatch(/aclexplode/);
    expect(sql).toMatch(/has_function_privilege/);
  });

  it("keeps the definition-unchanged postcondition", () => {
    expect(sql).toMatch(/function definition\/ownership\/security posture changed during grant hardening/i);
  });

  it("never grants execute to public, anon or service_role", () => {
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.join_pvp_room\(text\)\s+to\s+(public|anon|service_role)/i);
  });
});
