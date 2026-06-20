import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/web
const repoRoot = path.resolve(here, "..", "..");

// The card art lives in the repo's assets/cards (e.g. monk/hideon.png), so we
// point Vite's publicDir there: each image is served at "/<imageFile>" in dev
// and copied into the build. The card data is imported at build time, so the
// dev server only needs read access up to the repo root.
// Deploy-ready base path: "/" for local dev/preview, overridable for a
// subpath host (e.g. GitHub Pages project sites) via VITE_BASE=/euphoria-tcg/.
// cardImageUrl uses import.meta.env.BASE_URL, so art resolves under any base.
const base = process.env["VITE_BASE"] ?? "/";

// A build stamp so a deployed bundle's freshness is verifiable from the page
// (footer + window.__EUPHORIA_BUILD__). Uses the CI commit SHA when present,
// else a local timestamp. This is how we confirm GitHub Pages isn't serving a
// stale asset after a deploy.
const buildStamp =
  process.env["GITHUB_SHA"]?.slice(0, 7) ??
  new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  base,
  root: here,
  publicDir: path.join(repoRoot, "assets", "cards"),
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
  define: {
    "import.meta.env.VITE_BUILD_STAMP": JSON.stringify(buildStamp),
  },
});
