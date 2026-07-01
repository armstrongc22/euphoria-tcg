/**
 * Generate web-optimized card-art thumbnails. NON-DESTRUCTIVE: the original
 * 1024×1536 PNGs in assets/cards/** are the source of truth and are never
 * touched; this writes resized WebP copies to assets/cards/optimized/** mirroring
 * the same relative paths. Those are served at /beta/optimized/<faction>/<name>.webp
 * (assets/cards is the web app's publicDir) and used for hand/grid/board display,
 * while the full-size PNG is kept for card zoom/inspect.
 *
 * Display sizes are ~130–150px; THUMB_WIDTH=420 covers ~3× (retina) and still
 * lands around ~30 KB/card vs ~3.7 MB originals. Run: `npm run cards:optimize`.
 */
import sharp from "sharp";
import { readdirSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(repoRoot, "assets", "cards");
const outRoot = path.join(srcDir, "optimized");

const THUMB_WIDTH = 420;
const QUALITY = 78;

/** Recursively collect *.png under dir, skipping the optimized/ output tree. */
function pngs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (full === outRoot) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...pngs(full));
    else if (name.toLowerCase().endsWith(".png")) out.push(full);
  }
  return out;
}

const files = pngs(srcDir);
let done = 0;
let srcBytes = 0;
let outBytes = 0;

for (const file of files) {
  const rel = path.relative(srcDir, file); // e.g. sonic/brut.png
  const outFile = path.join(outRoot, rel).replace(/\.png$/i, ".webp");
  mkdirSync(path.dirname(outFile), { recursive: true });
  srcBytes += statSync(file).size;
  await sharp(file)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(outFile);
  outBytes += statSync(outFile).size;
  done += 1;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
  `✓ Optimized ${done} card images → ${outRoot}\n` +
    `  source: ${mb(srcBytes)} MB → optimized: ${mb(outBytes)} MB ` +
    `(${(outBytes / srcBytes * 100).toFixed(1)}% of original)`,
);
