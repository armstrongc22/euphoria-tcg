/**
 * CLI: validates data/cards/cards.json against the card schema and checks
 * that every imageFile resolves to an existing PNG under assets/cards.
 * Run from the repo root with: npm run validate:cards
 */
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { loadCards } from "./loader";
import { cardImagePath, cardsJsonPath } from "./paths";

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

const errors: string[] = [];

try {
  const cards = loadCards();

  for (const id of findDuplicates(cards.map((c) => c.id))) {
    errors.push(`duplicate id: ${id}`);
  }
  for (const slug of findDuplicates(cards.map((c) => c.slug))) {
    errors.push(`duplicate slug: ${slug}`);
  }
  for (const card of cards) {
    if (!existsSync(cardImagePath(card.imageFile))) {
      errors.push(`missing image for ${card.id}: ${card.imageFile}`);
    }
  }

  if (errors.length === 0) {
    console.log(`OK: ${cards.length} cards valid in ${cardsJsonPath()}`);
  }
} catch (error) {
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      errors.push(`schema: ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    throw error;
  }
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(message);
  }
  console.error(`FAILED: ${errors.length} problem(s) found`);
  process.exitCode = 1;
}
