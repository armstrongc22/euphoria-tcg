// ============================================================================
// Belt-and-braces cleanup for the PvP preview verification run.
// ============================================================================
// The API test deletes its own disposable users/rooms in a `finally`; this
// removes any leaked `pvpverify+<VERIFY_RUN_ID>-…` users (deleting a user
// cascades their pvp_rooms) after a crash/timeout. Scoped strictly to this
// run's prefix. Prints counts only — never emails/keys/tokens.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("cleanup: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to do.");
  process.exit(0);
}
const RUN_ID = process.env.VERIFY_RUN_ID ?? "local";
const PREFIX = `pvpverify+${RUN_ID}-`;
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
  console.error("cleanup: incomplete —", e instanceof Error ? e.message : String(e));
}
process.exit(0);
