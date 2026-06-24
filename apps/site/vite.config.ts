import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/site
const repoRoot = path.resolve(here, "..", "..");

// Deploy-ready base path: "/" for local dev/preview/Cloudflare-root, overridable
// for a subpath host via VITE_BASE. Card art (e.g. monk/hideon.png) lives in the
// repo's assets/cards, so we point publicDir there: @euphoria/core's
// cardImageUrl builds "/<imageFile>", which then resolves under any base. The
// dev server only needs read access up to the repo root (the shared @euphoria/*
// packages and card data live there).
const base = process.env["VITE_BASE"] ?? "/";

export default defineConfig({
  base,
  root: here,
  plugins: [react()],
  publicDir: path.join(repoRoot, "assets", "cards"),
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
});
