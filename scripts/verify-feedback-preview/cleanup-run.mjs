// ============================================================================
// Belt-and-braces cleanup for the preview verification run.
// ============================================================================
// The test scripts already delete their own disposable users in a `finally`,
// but a hard crash/timeout could leak one. This deletes every auth user whose
// email begins with this run's unique prefix (deleting a user cascades to its
// feedback_reports rows). Scoped strictly to `fbverify+<VERIFY_RUN_ID>-…` so it
// can never touch anything else. Prints counts only — never emails/keys/tokens.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VERIFY_RUN_ID (optional) in env.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("cleanup: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to do.");
  process.exit(0); // never fail the run over cleanup env
}
const RUN_ID = process.env.VERIFY_RUN_ID ?? "local";
const PREFIX = `fbverify+${RUN_ID}-`;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let removed = 0;
try {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) {
      if (typeof u.email === "string" && u.email.startsWith(PREFIX)) {
        const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
        if (!delErr) removed++;
      }
    }
    if (users.length < 1000) break;
  }
  console.log(`cleanup: removed ${removed} disposable user(s) for this run.`);
} catch (e) {
  // Report but exit 0: cleanup must not mask (or manufacture) a run failure.
  console.error("cleanup: incomplete —", e instanceof Error ? e.message : String(e));
}
process.exit(0);
