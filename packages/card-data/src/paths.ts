import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CARDS_JSON_RELATIVE = path.join("data", "cards", "cards.json");
const CARD_IMAGES_RELATIVE = path.join("assets", "cards");

/**
 * Walks up from this file until it finds the directory containing
 * data/cards/cards.json, so callers never need to hardcode machine paths.
 */
export function findRepoRoot(
  startDir: string = path.dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, CARDS_JSON_RELATIVE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${CARDS_JSON_RELATIVE} in any directory above ${startDir}`,
      );
    }
    dir = parent;
  }
}

export function cardsJsonPath(repoRoot: string = findRepoRoot()): string {
  return path.join(repoRoot, CARDS_JSON_RELATIVE);
}

export function cardImagesDir(repoRoot: string = findRepoRoot()): string {
  return path.join(repoRoot, CARD_IMAGES_RELATIVE);
}

/** Absolute path for a card's imageFile (e.g. "sonic/bit-schneider.png"). */
export function cardImagePath(
  imageFile: string,
  repoRoot: string = findRepoRoot(),
): string {
  return path.join(cardImagesDir(repoRoot), imageFile);
}
