import { readFileSync } from "node:fs";
import { cardListSchema, type Card } from "./schema";
import { cardsJsonPath } from "./paths";

/**
 * Loads and validates every card from data/cards/cards.json.
 * Throws a ZodError if any card fails schema validation.
 */
export function loadCards(filePath: string = cardsJsonPath()): Card[] {
  const json: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  return cardListSchema.parse(json);
}
