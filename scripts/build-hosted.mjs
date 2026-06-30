/**
 * Hosted-bundle build: produces a single static tree (apps/site/dist) that the
 * Cloudflare Worker (wrangler.jsonc) serves, containing BOTH:
 *
 *   apps/site/dist/        → the Euphoria Universe React site (base "/")
 *   apps/site/dist/beta/   → the playable TCG beta (apps/web, base "/beta/")
 *
 * Order matters: the site build empties apps/site/dist first, then the beta is
 * built into the dist/beta subfolder so it survives. Card art (assets/cards) is
 * copied into both trees by each app's publicDir, so images resolve under "/"
 * and "/beta/" respectively.
 *
 * Supabase auth/rewards: the beta reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * at build time (apps/web/.env.local locally, or the Cloudflare project's build
 * env in CI). Without them the beta still builds and runs in localStorage demo
 * mode. Run: `npm run build:hosted`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// 1) React site → apps/site/dist (its config empties the dir first).
console.log("▸ Building the Euphoria Universe site → apps/site/dist");
execFileSync(npm, ["run", "site:build"], { cwd: repoRoot, stdio: "inherit" });

// 2) TCG beta → apps/site/dist/beta (base /beta/ so it serves from the same origin).
console.log("\n▸ Building the TCG beta → apps/site/dist/beta (base /beta/)");
execFileSync(npm, ["run", "web:build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_BASE: "/beta/",
    WEB_OUT_DIR: "apps/site/dist/beta",
  },
});

console.log(
  "\n✓ Hosted bundle ready: apps/site/dist (site) + apps/site/dist/beta (beta).",
);
