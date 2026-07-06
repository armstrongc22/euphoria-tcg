/**
 * Generate web-optimized brand/faction logo WebPs. NON-DESTRUCTIVE: the
 * original PNGs in assets/source/** are the source of truth and are never
 * touched (kept in the repo for design work but NOT deployed — only repo-root
 * public/ ships in the build). This writes resized WebP copies into
 * public/images/**, which is all the site ever references.
 * Run: `npm run brand:optimize`.
 */
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [source png, output webp, target width px] — widths cover ~2× display size. */
const JOBS = [
  ["assets/source/brand/euphoria.png", "public/images/brand/euphoria.webp", 1200],
  ["assets/source/factions/dwarf_faction.png", "public/images/factions/dwarf_faction.webp", 900],
  ["assets/source/factions/monk_faction.png", "public/images/factions/monk_faction.webp", 900],
  ["assets/source/factions/sonic_faction.png", "public/images/factions/sonic_faction.webp", 900],
  ["assets/source/factions/surfer_faction.png", "public/images/factions/surfer_faction.webp", 900],
];

for (const [src, out, width] of JOBS) {
  const input = path.join(repoRoot, src);
  const output = path.join(repoRoot, out);
  const info = await sharp(input)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output);
  console.log(`✓ ${out} — ${info.width}×${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
}
