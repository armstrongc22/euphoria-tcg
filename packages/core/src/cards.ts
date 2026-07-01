/**
 * Browser-safe card data. The Node loader in @euphoria/card-data uses `fs`, so
 * the web app instead imports the raw JSON at build time and validates it with
 * the same zod schema — one source of truth, no server required.
 */
import { cardListSchema, type Card } from "@euphoria/card-data/schema";
import rawCards from "../../../data/cards/cards.json";

/** Every card, validated. Throws at module load if the data is malformed. */
export const cards: readonly Card[] = cardListSchema.parse(rawCards);

/**
 * The URL for a card's FULL-SIZE art under the app's base path. `imageFile` is
 * repo relative (e.g. "monk/hideon.png") and Vite serves assets/cards at the
 * base, so the URL is simply `${base}${imageFile}`. Use this for zoom/inspect.
 */
export function cardImageUrl(card: Card, base: string): string {
  return `${base}${card.imageFile}`;
}

/**
 * The URL for a card's web-optimized THUMBNAIL (a ~420px WebP, ~2% the size of
 * the full PNG). Generated non-destructively into assets/cards/optimized by
 * scripts/optimize-card-art.mjs and served at `${base}optimized/<name>.webp`.
 * Use this for hand/grid/board display; fall back to {@link cardImageUrl} if the
 * thumbnail is ever missing (see the web views' onerror handlers).
 */
export function cardThumbUrl(card: Card, base: string): string {
  return `${base}optimized/${card.imageFile.replace(/\.[a-z]+$/i, ".webp")}`;
}

/**
 * Warm the browser cache for a set of card thumbnails. Deduped across calls, so
 * requesting the same art twice never issues a second network request. Safe in
 * any environment (no-op without an Image constructor). Returns immediately.
 */
const preloaded = new Set<string>();
export function preloadCardArt(
  list: readonly Card[],
  base: string,
): void {
  if (typeof Image === "undefined") return;
  for (const card of list) {
    const url = cardThumbUrl(card, base);
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}
