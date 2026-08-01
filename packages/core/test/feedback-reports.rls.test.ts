// @vitest-environment node
/**
 * Real-database verification of the feedback_reports migration, run against an
 * in-process PostgreSQL (PGlite) — a genuine Postgres engine with real roles
 * and JWT-claim-backed sessions, not mocks. Docker/Supabase-CLI aren't
 * available in this environment, so PGlite is the disposable, non-production
 * database. It proves:
 *
 *   - the migration applies from a clean schema and is safely rerunnable,
 *   - the full permission matrix for anon / authenticated A / authenticated B /
 *     service_role via actual SQL under each role,
 *   - user_id spoofing is impossible (DB-enforced), FK cascade on user delete,
 *     and client_key de-duplication,
 *   - a pre-existing incompatible table makes the migration fail loudly.
 *
 * The harness mirrors Supabase: the anon/authenticated/service_role roles, the
 * broad default table grants Supabase applies (so the migration's REVOKEs are
 * actually exercised), and stub auth.users + auth.uid() reading the JWT claim.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260720121000_feedback_reports.sql",
  ),
  "utf8",
);

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

/** A fresh Supabase-like database: roles, default grants, auth stub, two users. */
async function freshSupabaseLike(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase grants new public tables broadly by default; replicate that so
    -- the migration's REVOKEs are genuinely tested.
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
    $$;
    insert into auth.users values ('${USER_A}'), ('${USER_B}');
  `);
  return db;
}

/** Switch the connection to a role with an optional JWT `sub` claim. */
async function asRole(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  sub?: string,
): Promise<void> {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    sub === undefined ? "" : JSON.stringify({ sub }),
  ]);
  await db.exec(`set role ${role};`);
}

/** Run a statement, returning the Postgres error code ("" on success). */
async function attempt(db: PGlite, sql: string): Promise<string> {
  try {
    await db.query(sql);
    return "";
  } catch (e) {
    return (e as { code?: string }).code ?? "ERROR";
  }
}

const INSUFFICIENT_PRIVILEGE = "42501";
const UNIQUE_VIOLATION = "23505";

const insertOwn = (key = "gen_random_uuid()") =>
  `insert into public.feedback_reports (client_key, type, message)
   values (${key}, 'bug', 'it broke')`;
const insertAs = (userId: string) =>
  `insert into public.feedback_reports (client_key, user_id, type, message)
   values (gen_random_uuid(), '${userId}', 'bug', 'spoof attempt')`;

describe("feedback_reports migration — apply + rerun", () => {
  it("applies from a clean schema and is safely rerunnable", async () => {
    const db = await freshSupabaseLike();
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    // Second application must succeed unchanged (guards are idempotent).
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='feedback_reports' order by 1`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      "build", "client_key", "context", "created_at", "email", "id",
      "message", "mobile", "selected_faction", "type", "user_agent", "user_id",
      "view",
    ]);
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid='public.feedback_reports'::regclass`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
  });
});

describe("feedback_reports permission matrix (real roles + JWT sessions)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshSupabaseLike();
    await db.exec(MIGRATION);
  });

  it("anon cannot insert, select, update, or delete", async () => {
    await asRole(db, "anon");
    expect(await attempt(db, insertOwn())).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await attempt(db, "select * from public.feedback_reports")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await attempt(db, "update public.feedback_reports set message='x'")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await attempt(db, "delete from public.feedback_reports")).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("authenticated user A can insert only rows for user A", async () => {
    await asRole(db, "authenticated", USER_A);
    // Own report (user_id omitted → defaults to auth.uid() = A) succeeds.
    expect(await attempt(db, insertOwn())).toBe("");
    // Explicit user_id = A also succeeds.
    expect(await attempt(db, insertAs(USER_A))).toBe("");
  });

  it("authenticated user A cannot spoof user B", async () => {
    await asRole(db, "authenticated", USER_A);
    expect(await attempt(db, insertAs(USER_B))).toBe(INSUFFICIENT_PRIVILEGE);
    // And every stored row is owned by A — no spoofed B row landed.
    await asRole(db, "service_role");
    const owners = await db.query<{ user_id: string }>(
      "select distinct user_id from public.feedback_reports",
    );
    expect(owners.rows.every((r) => r.user_id === USER_A)).toBe(true);
  });

  it("authenticated users cannot select, update, or delete reports", async () => {
    await asRole(db, "authenticated", USER_A);
    await db.query(insertOwn()); // seed one own row
    expect(await attempt(db, "select * from public.feedback_reports")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await attempt(db, "update public.feedback_reports set message='x'")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await attempt(db, "delete from public.feedback_reports")).toBe(INSUFFICIENT_PRIVILEGE);
    // Not even another user's rows are visible/removable.
    await asRole(db, "authenticated", USER_B);
    expect(await attempt(db, "select * from public.feedback_reports")).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("service_role can retrieve reports across users", async () => {
    await asRole(db, "authenticated", USER_A);
    await db.query(insertOwn());
    await asRole(db, "authenticated", USER_B);
    await db.query(insertOwn());
    await asRole(db, "service_role");
    const rows = await db.query<{ c: number }>(
      "select count(*)::int c from public.feedback_reports",
    );
    expect(rows.rows[0]?.c).toBe(2);
  });

  it("client_key is unique — a duplicate submission is a 23505, not a second row", async () => {
    await asRole(db, "authenticated", USER_A);
    const key = "'33333333-3333-3333-3333-333333333333'";
    expect(await attempt(db, insertOwn(key))).toBe("");
    expect(await attempt(db, insertOwn(key))).toBe(UNIQUE_VIOLATION);
  });

  it("deleting a user cascades to their reports", async () => {
    await asRole(db, "authenticated", USER_A);
    await db.query(insertOwn());
    await asRole(db, "service_role");
    await db.exec(`reset role; delete from auth.users where id = '${USER_A}';`);
    const rows = await db.query<{ c: number }>(
      "select count(*)::int c from public.feedback_reports",
    );
    expect(rows.rows[0]?.c).toBe(0);
  });
});

describe("feedback_reports stale-schema guard", () => {
  it("fails loudly against a pre-existing incompatible table (old README schema)", async () => {
    const db = await freshSupabaseLike();
    // The old README SQL: nullable user_id, no client_key.
    await db.exec(`
      create table public.feedback_reports (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references auth.users (id) on delete set null,
        email text, type text not null, message text not null,
        created_at timestamptz not null default now()
      );
    `);
    // create table if not exists would skip; the guard must raise instead.
    await expect(db.exec(MIGRATION)).rejects.toThrow(/client_key column/i);
  });

  it("accepts a table that already matches (its own rerun is not 'stale')", async () => {
    const db = await freshSupabaseLike();
    await db.exec(MIGRATION);
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
  });
});
