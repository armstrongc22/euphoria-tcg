// ============================================================================
// Real Supabase API-layer verification of join_pvp_room after grant hardening.
// ============================================================================
// Exercises the RPC through PostgREST + GoTrue with real anon, three JWT-backed
// users (A, B, C), and the service role. Reads credentials only from the
// environment; prints only operation -> status/code + PASS/FAIL (never keys or
// tokens). Creates run-scoped disposable users + rooms and deletes them at the
// end. NEVER run against production.
//
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (disposable only).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { deniedByPermission } from "./pvp-classify.mjs";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("FAIL: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (disposable project).");
  process.exit(1);
}
const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, noPersist);
const anon = createClient(URL, ANON, noPersist);
const RUN_ID = process.env.VERIFY_RUN_ID ?? `local-${randomUUID().slice(0, 8)}`;

let pass = 0, fail = 0;
function check(name, ok, d = {}) {
  const bits = [d.status !== undefined ? `http=${d.status}` : null, d.code !== undefined ? `code=${d.code}` : null]
    .filter(Boolean).join(" ");
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${bits ? "  (" + bits + ")" : ""}`);
  ok ? pass++ : fail++;
}
const join = (client, code) => client.rpc("join_pvp_room", { p_code: code });
const seated = (res) => (Array.isArray(res.data) ? res.data[0] : res.data)?.player_two;

async function signIn() {
  const email = `pvpverify+${RUN_ID}-${randomUUID()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("createUser: " + error.message);
  const client = createClient(URL, ANON, noPersist);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error("signIn: " + e2.message);
  return { id: data.user.id, client };
}
async function makeRoom({ owner, playerTwo = null, expiresMs = 30 * 60_000 }) {
  const code = `p-${RUN_ID}-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("pvp_rooms").insert({
    room_code: code, created_by: owner, player_one: owner, player_two: playerTwo,
    status: "waiting", expires_at: new Date(Date.now() + expiresMs).toISOString(),
  });
  if (error) throw new Error("makeRoom: " + error.message);
  return code;
}

let A, B, C;
try {
  A = await signIn(); B = await signIn(); C = await signIn();
  const roomB = await makeRoom({ owner: B.id });                       // A will join
  const roomA = await makeRoom({ owner: A.id });                       // B will join
  const roomOwnA = await makeRoom({ owner: A.id });                    // A joins own
  const roomFull = await makeRoom({ owner: B.id, playerTwo: C.id });   // A joins full
  const roomExp = await makeRoom({ owner: B.id, expiresMs: -60_000 }); // C joins expired

  // Establish the function EXISTS via an authenticated success first.
  const aJoin = await join(A.client, roomB);
  const functionExists = aJoin.error === null;
  check("authenticated A joins a valid room created by B", aJoin.error === null && seated(aJoin) === A.id,
    { status: aJoin.status, code: aJoin.error?.code });

  check("authenticated B joins a valid room created by A",
    await join(B.client, roomA).then((r) => r.error === null && seated(r) === B.id), { });

  const rejoin = await join(A.client, roomB);
  check("duplicate/reconnect join is idempotent (same seat, no error)",
    rejoin.error === null && seated(rejoin) === A.id, { status: rejoin.status });

  check("a supplied identity cannot override auth.uid() (seat == caller)",
    seated(aJoin) === A.id && seated(rejoin) === A.id);

  const own = await join(A.client, roomOwnA);
  check("a user cannot join their own room", /own room/i.test(own.error?.message ?? ""),
    { status: own.status, code: own.error?.code });

  const invalid = await join(B.client, `p-${RUN_ID}-nope`);
  check("invalid room is rejected", /not found/i.test(invalid.error?.message ?? ""),
    { status: invalid.status, code: invalid.error?.code });

  const full = await join(A.client, roomFull);
  check("full room is rejected", /room full/i.test(full.error?.message ?? ""),
    { status: full.status, code: full.error?.code });

  const expired = await join(C.client, roomExp);
  check("expired room is rejected", /expired/i.test(expired.error?.message ?? ""),
    { status: expired.status, code: expired.error?.code });

  const anonCall = await join(anon, roomA);
  check("anonymous RPC call is denied BY PERMISSION (not missing function)",
    anonCall.error !== null && deniedByPermission(anonCall.status, anonCall.error?.code, functionExists),
    { status: anonCall.status, code: anonCall.error?.code });

  const svcCall = await join(admin, roomA);
  check("service-role RPC execution is denied (intentional least privilege)",
    svcCall.error !== null && deniedByPermission(svcCall.status, svcCall.error?.code, functionExists),
    { status: svcCall.status, code: svcCall.error?.code });
} catch (e) {
  check("harness ran without setup errors", false);
  console.error("  harness error:", e instanceof Error ? e.message : String(e));
} finally {
  try {
    const ids = [A?.id, B?.id, C?.id].filter(Boolean);
    if (ids.length) await admin.from("pvp_rooms").delete().in("created_by", ids);
    for (const u of [A, B, C]) if (u) await admin.auth.admin.deleteUser(u.id);
    check("cleanup removed disposable rooms and users", true);
  } catch (e) {
    check("cleanup removed disposable rooms and users", false);
    console.error("  cleanup error:", e instanceof Error ? e.message : String(e));
  }
}
console.log(`\n== PvP RPC API matrix: ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);
