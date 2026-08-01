// ============================================================================
// Application integration: the REAL @euphoria/core feedback queue/retry/dead-
// letter logic driven against a DISPOSABLE Supabase branch.
// ============================================================================
// Run with tsx (imports the TypeScript core directly):
//   export SUPABASE_URL=...            # DISPOSABLE project only
//   export SUPABASE_ANON_KEY=...
//   export SUPABASE_SERVICE_ROLE_KEY=...
//   npx tsx scripts/verify-feedback-preview/app-integration-test.ts
//
// Reads credentials only from the environment. Prints no keys/tokens/bodies.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createSupabaseAuth } from "@euphoria/core/auth";
import type { KeyValueStore } from "@euphoria/core/signup";
import {
  buildFeedbackInsert,
  deadLetterFeedbackCount,
  loadDeadLetterFeedback,
  pendingFeedbackCount,
  savePendingFeedback,
  syncPendingFeedback,
  type FeedbackInput,
  type FeedbackInsert,
} from "@euphoria/core/feedback";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("FAIL: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (disposable project).");
  process.exit(1);
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL!, SERVICE!, noPersist);

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? "  (" + detail + ")" : ""}`);
  ok ? pass++ : fail++;
}
function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
async function rowCount(client_key: string): Promise<number> {
  const { count } = await admin
    .from("feedback_reports").select("*", { count: "exact", head: true }).eq("client_key", client_key);
  return count ?? 0;
}
function inputFor(userId: string, extra: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    type: "bug", message: "integration test", userId, email: null, view: "verify",
    build: "verify", userAgent: "verify", mobile: false, selectedFaction: null,
    includeDebug: false, ...extra,
  };
}

// Run-scoped email prefix so cleanup-run.mjs can target exactly this run.
const RUN_ID = process.env.VERIFY_RUN_ID ?? `local-${randomUUID().slice(0, 8)}`;

async function main(): Promise<void> {
  const email = `fbverify+${RUN_ID}-${randomUUID()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw new Error("createUser failed: " + cErr.message);
  const userId = created.user.id;
  const userClient: SupabaseClient = createClient(URL!, ANON!, noPersist);
  const { error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error("signIn failed: " + sErr.message);
  const auth = createSupabaseAuth(userClient); // the real app Auth

  const store = memoryStore();
  const HOUR = 3_600_000;

  try {
    // 1) Normal submit creates exactly one row. ------------------------------
    const normal = buildFeedbackInsert(inputFor(userId, { message: "normal report" }));
    await auth.saveFeedback(normal);
    check("normal submit creates exactly one row", (await rowCount(normal.client_key)) === 1);

    // 2) Transient failure enters the local queue (UI catch path). -----------
    const queued = buildFeedbackInsert(inputFor(userId, { message: "queued while offline" }));
    savePendingFeedback(store, queued, "simulated network failure");
    check("transient failure enters the queue", pendingFeedbackCount(store) === 1);

    // 3) Reconnect: retries, persists once, leaves the queue. -----------------
    const r1 = await syncPendingFeedback(auth, store, 0);
    check("reconnect sends the queued report", r1.sent === 1 && pendingFeedbackCount(store) === 0);
    check("queued report persisted exactly once", (await rowCount(queued.client_key)) === 1);

    // 4) Repeated retries do not create a duplicate (same client_key). --------
    savePendingFeedback(store, queued, "retry again"); // same insert, same key
    await syncPendingFeedback(auth, store, HOUR); // resend -> DB 23505 swallowed as success
    check("repeated retry does not duplicate the row", (await rowCount(queued.client_key)) === 1);
    check("queue cleared after duplicate retry", pendingFeedbackCount(store) === 0);

    // 5) Permanently-invalid report -> dead-letter, not retried on reconnect. -
    const huge = { blob: "x".repeat(40_000) }; // context > 32 KB -> CHECK 23514
    const bad = buildFeedbackInsert(inputFor(userId, { message: "too big", match: huge }));
    savePendingFeedback(store, bad, "queued");
    await syncPendingFeedback(auth, store, 2 * HOUR);
    check("permanent rejection is dead-lettered", deadLetterFeedbackCount(store) === 1 && pendingFeedbackCount(store) === 0);
    check("no DB row created for the permanent failure", (await rowCount(bad.client_key)) === 0);
    const deadReason = loadDeadLetterFeedback(store)[0]?.reason;
    check("dead-letter reason is 'permanent'", deadReason === "permanent", `reason=${deadReason}`);
    // Retry twice more — dead-letters must NOT be retried.
    await syncPendingFeedback(auth, store, 10 * HOUR);
    await syncPendingFeedback(auth, store, 20 * HOUR);
    check("dead-letter is not retried on reconnect", deadLetterFeedbackCount(store) === 1 && pendingFeedbackCount(store) === 0);

    // 6) No auth token / sensitive body stored locally. -----------------------
    const raw = JSON.stringify([
      store.getItem("euphoria.pendingFeedback.v1"),
      store.getItem("euphoria.deadFeedback.v1"),
    ]);
    const leak = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.|bearer\s|access_token|apikey|service_role|authorization/i.test(raw);
    check("no auth token / apikey / bearer stored in local queue or dead-letter", !leak);
    const failDetail = loadDeadLetterFeedback(store)[0]?.failure;
    check("dead-letter failure detail is a safe {code, message} only",
      !!failDetail && typeof failDetail.message === "string" && failDetail.message.length <= 300
        && Object.keys(failDetail).sort().join(",") === "code,message",
      `code=${failDetail?.code}`);

    // Confirm the earlier normal + queued rows are the only ones for this user.
    const { count } = await admin.from("feedback_reports").select("*", { count: "exact", head: true }).eq("user_id", userId);
    check("exactly two rows persisted for the user (normal + queued)", count === 2, `rows=${count}`);
  } finally {
    // Cleanup: delete the disposable user (cascade removes its rows).
    try {
      await admin.from("feedback_reports").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
      check("cleanup removed the disposable user and rows", true);
    } catch (e) {
      check("cleanup removed the disposable user and rows", false);
      console.error("  cleanup error:", e instanceof Error ? e.message : String(e));
    }
  }
}

main()
  .catch((e) => { check("integration harness ran without setup errors", false); console.error("  ", e instanceof Error ? e.message : String(e)); })
  .finally(() => {
    console.log(`\n== app integration: ${pass} passed, ${fail} failed ==`);
    process.exit(fail === 0 ? 0 : 1);
  });
