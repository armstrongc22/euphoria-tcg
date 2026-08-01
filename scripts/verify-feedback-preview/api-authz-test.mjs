// ============================================================================
// Real Supabase API-layer authorization matrix for feedback_reports.
// ============================================================================
// Exercises PostgREST + GoTrue + RLS + grants end-to-end with real anon, two
// JWT-backed users (A, B), and the service role. Reads credentials ONLY from
// the environment and never prints keys or tokens — only operation -> HTTP
// status / Postgres error code and a PASS/FAIL verdict.
//
//   export SUPABASE_URL=...            # DISPOSABLE project only
//   export SUPABASE_ANON_KEY=...
//   export SUPABASE_SERVICE_ROLE_KEY=...
//   node scripts/verify-feedback-preview/api-authz-test.mjs
//
// Uses the project's existing @supabase/supabase-js. Creates two disposable
// users and deletes them (and their rows) at the end. NEVER run against prod.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { isAuthzDenied, tableProbeVerdict } from "./authz-classify.mjs";

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

let pass = 0, fail = 0;
/** Records a check; `detail` is a safe {status, code} — never a key/token. */
function check(name, ok, detail = {}) {
  const tag = ok ? "PASS" : "FAIL";
  const bits = [detail.status !== undefined ? `http=${detail.status}` : null,
                detail.code !== undefined ? `code=${detail.code}` : null]
    .filter(Boolean).join(" ");
  console.log(`${tag}: ${name}${bits ? "  (" + bits + ")" : ""}`);
  ok ? pass++ : fail++;
}
const row = (extra = {}) => ({ client_key: randomUUID(), type: "bug", message: "verify", ...extra });

// Run-scoped email prefix so cleanup-run.mjs can target exactly this run.
const RUN_ID = process.env.VERIFY_RUN_ID ?? `local-${randomUUID().slice(0, 8)}`;

async function signInUser() {
  const email = `fbverify+${RUN_ID}-${randomUUID()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("createUser failed: " + error.message);
  const client = createClient(URL, ANON, noPersist);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error("signIn failed: " + signInErr.message);
  return { id: data.user.id, client };
}

// Preflight: the table MUST exist (migration applied). A missing table
// (404 / PGRST205) is a SETUP failure, not an authorization result — abort so
// the denial checks below can never false-pass on a missing table.
{
  const probe = await admin
    .from("feedback_reports").select("*", { count: "exact", head: true });
  if (tableProbeVerdict(probe.status, probe.error?.code) === "missing") {
    check("preflight: feedback_reports exists (migration applied)", false,
      { status: probe.status, code: probe.error?.code });
    console.log("\n== API authorization matrix: ABORTED — table missing (migration not applied) ==");
    process.exit(1);
  }
  check("preflight: feedback_reports exists (migration applied)", true, { status: probe.status });
}

let A, B;
try {
  A = await signInUser();
  B = await signInUser();

  // --- anon: everything denied (must be a genuine authz denial) -------------
  {
    const ins = await anon.from("feedback_reports").insert(row({ user_id: A.id }));
    check("anon INSERT is denied (authz, not missing-table)", isAuthzDenied(ins.status, ins.error?.code),
      { status: ins.status, code: ins.error?.code });
    const sel = await anon.from("feedback_reports").select("id");
    check("anon SELECT is denied (authz, not missing-table)", isAuthzDenied(sel.status, sel.error?.code),
      { status: sel.status, code: sel.error?.code });
    const upd = await anon.from("feedback_reports").update({ message: "x" }).eq("type", "bug");
    check("anon UPDATE is denied (authz, not missing-table)", isAuthzDenied(upd.status, upd.error?.code),
      { status: upd.status, code: upd.error?.code });
    const del = await anon.from("feedback_reports").delete().eq("type", "bug");
    check("anon DELETE is denied (authz, not missing-table)", isAuthzDenied(del.status, del.error?.code),
      { status: del.status, code: del.error?.code });
  }

  // --- user A: insert own (no .select), no returned representation ----------
  {
    const ins = await A.client.from("feedback_reports").insert(row()); // user_id defaults to A
    check("user A INSERT own (no .select) succeeds", ins.error === null, { status: ins.status });
    check("user A INSERT returns no representation (data is null)", ins.data === null,
      { status: ins.status });

    const insRepr = await A.client.from("feedback_reports").insert(row()).select();
    check("user A INSERT .select() (returned representation) is denied",
      isAuthzDenied(insRepr.status, insRepr.error?.code),
      { status: insRepr.status, code: insRepr.error?.code });

    const spoof = await A.client.from("feedback_reports").insert(row({ user_id: B.id }));
    check("user A cannot INSERT a row owned by user B", isAuthzDenied(spoof.status, spoof.error?.code),
      { status: spoof.status, code: spoof.error?.code });

    const sel = await A.client.from("feedback_reports").select("id");
    check("user A cannot SELECT any rows", isAuthzDenied(sel.status, sel.error?.code),
      { status: sel.status, code: sel.error?.code });
    const upd = await A.client.from("feedback_reports").update({ message: "x" }).eq("type", "bug");
    check("user A cannot UPDATE", isAuthzDenied(upd.status, upd.error?.code),
      { status: upd.status, code: upd.error?.code });
    const del = await A.client.from("feedback_reports").delete().eq("type", "bug");
    check("user A cannot DELETE", isAuthzDenied(del.status, del.error?.code),
      { status: del.status, code: del.error?.code });
  }

  // --- user B: cannot see user A's report ----------------------------------
  {
    const sel = await B.client.from("feedback_reports").select("id");
    check("user B cannot access user A's report", isAuthzDenied(sel.status, sel.error?.code),
      { status: sel.status, code: sel.error?.code });
  }

  // --- duplicate client_key -> uniqueness failure --------------------------
  {
    const key = randomUUID();
    const first = await A.client.from("feedback_reports").insert(row({ client_key: key }));
    check("user A INSERT (unique key) succeeds", first.error === null, { status: first.status });
    const dup = await A.client.from("feedback_reports").insert(row({ client_key: key }));
    check("duplicate client_key returns a uniqueness failure (23505)",
      dup.error?.code === "23505", { status: dup.status, code: dup.error?.code });
  }

  // --- service role: retrieval works ---------------------------------------
  {
    const sel = await admin.from("feedback_reports").select("id, user_id");
    const own = (sel.data ?? []).filter((r) => r.user_id === A.id || r.user_id === B.id).length;
    check("service_role can retrieve reports", sel.error === null && own >= 1,
      { status: sel.status });
    check("service_role sees only A's rows (spoof of B never landed)",
      (sel.data ?? []).every((r) => r.user_id !== B.id), { status: sel.status });
  }
} catch (e) {
  check("test harness ran without setup errors", false);
  console.error("  harness error:", (e && e.message) ? e.message : String(e));
} finally {
  // Cleanup: delete rows then the disposable users (cascade also clears rows).
  try {
    if (A || B) {
      await admin.from("feedback_reports").delete().in("user_id", [A?.id, B?.id].filter(Boolean));
    }
    if (A) await admin.auth.admin.deleteUser(A.id);
    if (B) await admin.auth.admin.deleteUser(B.id);
    console.log("PASS: cleanup removed disposable users and their rows");
    pass++;
  } catch (e) {
    console.log("FAIL: cleanup incomplete — remove test users manually");
    console.error("  cleanup error:", (e && e.message) ? e.message : String(e));
    fail++;
  }
}

console.log(`\n== API authorization matrix: ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);
