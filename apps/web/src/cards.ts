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
 * The URL for a card's art under the app's base path. `imageFile` is repo
 * relative (e.g. "monk/hideon.png") and Vite serves assets/cards at the base,
 * so the URL is simply `${base}${imageFile}`.
 */
export function cardImageUrl(card: Card, base: string): string {
  return `${base}${card.imageFile}`;
}
