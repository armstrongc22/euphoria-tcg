/**
 * Deck construction for the simulator. Builds a playable `deckSize`-card deck
 * by sampling from the real card pool — guaranteeing enough Warriors that an
 * agent can establish a board, with the remainder drawn from support cards
 * (Items / Weapons / Attacks). Sampling is seeded, so a given rng yields the
 * same deck every run. This is a starter heuristic, not a deck-validity model;
 * the rules for legal decks (copy limits, faction rules) can layer on later.
 */
import { type Card } from "@euphoria/card-data";
import { shuffleCards } from "@euphoria/game-engine";

/**
 * The factions that can field a deck. Shaman is intentionally excluded — its
 * cards are special, earned later — so the simulator never builds Shaman decks.
 */
export const DECK_FACTIONS = ["Monk", "Surfer", "Dwarf", "Sonic"] as const;
export type DeckFaction = (typeof DECK_FACTIONS)[number];

/**
 * Neutral staples every deck is guaranteed at least one of: deck search,
 * revival, and the GILs Unit tempo tool. Sampling may add further copies
 * (they sit in the Neutral support pool too), but inclusion is never left to
 * chance.
 */
export const DECK_STAPLE_SLUGS = [
  "lahkt-brand-family-products",
  "totems-creation",
  "gils-unit",
] as const;

export interface DeckOptions {
  /** Total cards in the deck (must match the engine's deckSize). Default 30. */
  size?: number;
  /** How many of those are Warriors. Default 20. Clamped to the free slots. */
  warriorCount?: number;
  /** Guaranteed cards, one copy each, placed before sampling and counted toward size. */
  staples?: readonly Card[];
}

function sample<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/**
 * Samples a deck (with repetition) from `pool`. Throws if the pool lacks the
 * card types a deck needs, so a bad pool fails loudly instead of at game time.
 */
export function buildDeck(
  pool: readonly Card[],
  rng: () => number,
  options: DeckOptions = {},
): Card[] {
  const size = options.size ?? 30;
  const staples = options.staples ?? [];
  if (staples.length > size) {
    throw new Error(`buildDeck: ${staples.length} staples exceed deck size ${size}.`);
  }
  const warriorCount = Math.min(options.warriorCount ?? 20, size - staples.length);

  // Staples are placed exactly once, so keep them out of the random pools —
  // the sampler must never add extra copies of a guaranteed card.
  const stapleSlugs = new Set(staples.map((c) => c.slug));
  const sampleable = pool.filter((c) => !stapleSlugs.has(c.slug));
  const warriors = sampleable.filter((c) => c.type === "Warrior");
  const support = sampleable.filter((c) => c.type !== "Warrior");
  if (warriors.length === 0) {
    throw new Error("buildDeck: the card pool has no Warriors.");
  }
  const filler = support.length > 0 ? support : warriors;

  const deck: Card[] = [...staples];
  for (let i = 0; i < warriorCount; i++) deck.push(sample(warriors, rng));
  while (deck.length < size) deck.push(sample(filler, rng));
  return shuffleCards(deck, rng);
}

/**
 * Builds a faction deck: that faction's Warriors and Attack cards plus the
 * shared Neutral support (Items / Weapons). Cards of other factions — Shaman
 * included — never appear. Attack cards must match the attacker's faction to
 * be playable, so only the faction's own Attacks are drawn; Items and Weapons
 * are all Neutral, so they cross every faction deck.
 */
export function buildFactionDeck(
  pool: readonly Card[],
  faction: DeckFaction,
  rng: () => number,
  options: DeckOptions = {},
): Card[] {
  const subset = pool.filter(
    (c) => c.faction === faction || c.faction === "Neutral",
  );
  const staples = options.staples ?? resolveStaples(pool, DECK_STAPLE_SLUGS);
  return buildDeck(subset, rng, { ...options, staples });
}

/** Looks up each required staple by slug, failing loudly if the pool lacks one. */
function resolveStaples(
  pool: readonly Card[],
  slugs: readonly string[],
): Card[] {
  return slugs.map((slug) => {
    const card = pool.find((c) => c.slug === slug);
    if (card === undefined) {
      throw new Error(`buildFactionDeck: required staple "${slug}" not in the pool.`);
    }
    return card;
  });
}
