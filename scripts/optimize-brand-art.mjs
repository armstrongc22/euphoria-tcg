/**
 * Brand/faction logo pipeline: checkerboard removal → true-alpha WebP.
 *
 * The raw exports in assets/source/** are RGB screenshots of transparency
 * previews — the grey/white checkerboard is BAKED INTO the pixels (no alpha
 * channel). This script reconstructs real transparency:
 *
 *   1. Detect the two checker colors (the two dominant flat colors in the
 *      image corners).
 *   2. Mark checker-colored pixels (tight tolerance) and connected-component
 *      label them. A component is background if it touches the border OR
 *      contains BOTH checker shades (real checker regions always alternate;
 *      the art's own white strokes are single-shade and survive).
 *   3. Erase background to alpha 0, then a one-pass defringe: opaque pixels
 *      adjacent to background that still read as near-checker fade out, so
 *      no white halo rings the art on dark pages.
 *   4. Resize + export as WebP **with alpha** into public/images/** — the
 *      only files pages reference. Sources are never modified.
 *
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

const TOL = 10; // "is checker-colored" exact-ish match
const FRINGE_TOL = 46; // defringe: near-checker edge blend
const MIN_BOTH = 25; // px of each shade for an enclosed region to count as checker

const key = (r, g, b) => (r << 16) | (g << 8) | b;

/** The two dominant colors across the four 90×90 corners. */
function checkerColors(data, width, height) {
  const counts = new Map();
  const corner = (x0, y0) => {
    for (let y = y0; y < y0 + 90; y++) {
      for (let x = x0; x < x0 + 90; x++) {
        const i = (y * width + x) * 3;
        const k = key(data[i], data[i + 1], data[i + 2]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  };
  corner(0, 0);
  corner(width - 90, 0);
  corner(0, height - 90);
  corner(width - 90, height - 90);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
}

const dist = (data, i, c) =>
  Math.max(
    Math.abs(data[i] - c[0]),
    Math.abs(data[i + 1] - c[1]),
    Math.abs(data[i + 2] - c[2]),
  );

async function process(src, out, width) {
  const input = path.join(repoRoot, src);
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const [c1, c2] = checkerColors(data, W, H);
  const n = W * H;

  // 1 = checker-colored, later 2 = confirmed background.
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 3;
    if (dist(data, i, c1) <= TOL || dist(data, i, c2) <= TOL) mask[p] = 1;
  }

  // Connected components over checker-colored pixels (4-neighbour BFS).
  const stack = new Int32Array(n);
  const comp = new Int32Array(n).fill(-1);
  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] !== 1 || comp[seed] !== -1) continue;
    let sp = 0;
    stack[sp++] = seed;
    comp[seed] = seed;
    const members = [];
    let touchesBorder = false;
    let n1 = 0;
    let n2 = 0;
    while (sp > 0) {
      const p = stack[--sp];
      members.push(p);
      const x = p % W;
      const y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesBorder = true;
      if (dist(data, p * 3, c1) <= TOL) n1++;
      else n2++;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= n) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        if (mask[q] === 1 && comp[q] === -1) {
          comp[q] = seed;
          stack[sp++] = q;
        }
      }
    }
    const isBackground = touchesBorder || (n1 >= MIN_BOTH && n2 >= MIN_BOTH);
    if (isBackground) for (const p of members) mask[p] = 2;
  }

  // Build RGBA: background → alpha 0; defringe ring → soft alpha.
  const rgba = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 3;
    const o = p * 4;
    rgba[o] = data[i];
    rgba[o + 1] = data[i + 1];
    rgba[o + 2] = data[i + 2];
    if (mask[p] === 2) {
      rgba[o + 3] = 0;
      continue;
    }
    let alpha = 255;
    const x = p % W;
    const y = (p / W) | 0;
    const nearBg =
      (x > 0 && mask[p - 1] === 2) ||
      (x < W - 1 && mask[p + 1] === 2) ||
      (y > 0 && mask[p - W] === 2) ||
      (y < H - 1 && mask[p + W] === 2);
    if (nearBg) {
      const d = Math.min(dist(data, i, c1), dist(data, i, c2));
      if (d < FRINGE_TOL) alpha = Math.round((d / FRINGE_TOL) * 255);
    }
    rgba[o + 3] = alpha;
  }

  const output = path.join(repoRoot, out);
  const res = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(output);
  console.log(
    `✓ ${out} — ${res.width}×${res.height}, ${(res.size / 1024).toFixed(0)} KB ` +
      `(checker ${c1.join(",")} / ${c2.join(",")} removed)`,
  );
}

for (const [src, out, width] of JOBS) await process(src, out, width);
