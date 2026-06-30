import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
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

// Vite's single publicDir is already spoken for by the card art (above), but the
// interactive map's base image lives in the repo-root `public/` (e.g.
// /maps/euphoria-base-map.png). This plugin serves that folder as additional
// static root: streamed in dev, copied into dist/ on build. Keeping `public/`
// as the canonical source means there's no duplicated binary to keep in sync.
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function rootPublicAssets(dir: string): Plugin {
  return {
    name: "euphoria-root-public-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (url === undefined) return next();
        const urlPath = decodeURIComponent(url.split("?")[0] ?? "");
        const filePath = path.join(dir, urlPath);
        // Guard against path traversal escaping the public dir.
        if (filePath !== dir && !filePath.startsWith(dir + path.sep)) {
          return next();
        }
        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) return next();
          const mime = MIME[path.extname(filePath).toLowerCase()];
          if (mime !== undefined) res.setHeader("Content-Type", mime);
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
    closeBundle() {
      if (!fs.existsSync(dir)) return;
      fs.cpSync(dir, path.join(here, "dist"), { recursive: true });
    },
  };
}

export default defineConfig({
  base,
  root: here,
  plugins: [react(), rootPublicAssets(path.join(repoRoot, "public"))],
  publicDir: path.join(repoRoot, "assets", "cards"),
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
});
