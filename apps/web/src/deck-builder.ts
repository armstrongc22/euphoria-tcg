/**
 * Collection-based deck builder — PURE logic, no DOM, no network. Lets a player
 * assemble their active 30-card deck from the cards they may use: their faction's
 * fixed starter recipe plus the reward cards they own.
 *
 * Nothing here invents new rules. Eligibility reuses {@link isRewardEligible}
 * from ./rewards (own-faction Warriors/Attacks, generic Neutral Items/Weapons,
 * faction-specific Neutral only for its faction, never Shaman or off-faction).
 * Availability reuses the frozen starter recipe (./starter) as the baseline and
 * {@link groupOwnedBySlug} for owned reward counts. Card DATA, the starter
 * recipes, reward tiers, and the simulator are all untouched.
 *
 * The local (demo) persistence layer mirrors ./rewards: storage is injected via
 * {@link KeyValueStore} so it's fully unit-testable without a browser, and decks
 * are stored per faction so each faction's saved deck survives independently.
 */
import type { Card } from "@euphoria/card-data/schema";
import { groupOwnedBySlug, isRewardEligible, type OwnedCardRecord } from "@euphoria/core/rewards";
import type { KeyValueStore } from "@euphoria/core/signup";
import {
  STARTER_DECK_SIZE,
  STARTER_FACTIONS,
  getRecipe,
  type DeckEntry,
  type StarterFaction,
} from "@euphoria/core/starter";

/** Re-exported so views can show the target without reaching into ./starter. */
export { STARTER_DECK_SIZE } from "@euphoria/core/starter";

/** A saved active deck: the faction it belongs to and its card list. */
export interface ActiveDeck {
  readonly faction: StarterFaction;
  readonly cards: readonly DeckEntry[];
}

/** A persisted/loaded active deck: the deck plus its last-saved stamp. */
export interface ActiveDeckRecord extends ActiveDeck {
  readonly updated_at: string;
}

/** Columns upserted into `active_decks` when a deck is saved. */
export interface ActiveDeckPayload {
  readonly user_id: string;
  readonly faction: StarterFaction;
  /** The deck list, stored as jsonb. */
  readonly cards: readonly DeckEntry[];
  readonly updated_at: string;
}

/** Where an available card's copies come from, for grouped display. */
export type AvailableSource = "starter" | "reward" | "both";

/** One row in the builder's "available cards" pool. */
export interface AvailableCard {
  readonly card: Card;
  /** Total copies the player may include (starter baseline + owned rewards). */
  readonly available: number;
  /** Copies currently in the working deck. */
  readonly used: number;
  /** Whether the copies are from the starter deck, rewards, or both. */
  readonly source: AvailableSource;
}

/** A single validation failure on an active deck. */
export type DeckError =
  | { readonly kind: "under" | "over"; readonly size: number }
  | {
      readonly kind: "exceedsOwned";
      readonly slug: string;
      readonly used: number;
      readonly available: number;
    }
  | { readonly kind: "ineligible"; readonly slug: string }
  | { readonly kind: "unknown"; readonly slug: string };

/** The result of validating an active deck against a player's collection. */
export interface DeckValidation {
  readonly valid: boolean;
  /** Total cards in the deck (sum of quantities). */
  readonly size: number;
  readonly errors: readonly DeckError[];
}

/** Display order for grouping/sorting the available pool. */
const TYPE_ORDER: Readonly<Record<Card["type"], number>> = {
  Warrior: 0,
  Attack: 1,
  Item: 2,
  Weapon: 3,
};

/** localStorage key. Versioned so the shape can change later without clashes. */
export const ACTIVE_DECK_STORAGE_KEY = "euphoria.activeDeck.v1";

/** The faction starter recipe as a baseline slug→quantity map. */
export function starterBaseline(faction: StarterFaction): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of getRecipe(faction).cards) {
    map.set(entry.slug, (map.get(entry.slug) ?? 0) + entry.quantity);
  }
  return map;
}

/**
 * Total copies of each slug a player may include: the starter baseline plus the
 * number of owned reward copies (one row per copy in `owned_cards`). Slugs the
 * player neither starts with nor owns are absent (treated as 0).
 */
export function computeAvailability(
  faction: StarterFaction,
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_name">[],
): Map<string, number> {
  const avail = new Map(starterBaseline(faction));
  for (const group of groupOwnedBySlug(owned)) {
    avail.set(group.slug, (avail.get(group.slug) ?? 0) + group.count);
  }
  return avail;
}

/** Sum of quantities across a deck's entries. */
export function deckSize(cards: readonly DeckEntry[]): number {
  return cards.reduce((sum, entry) => sum + entry.quantity, 0);
}

/** Aggregates a deck's entries into a slug→used-quantity map (folds duplicates). */
function usedBySlug(cards: readonly DeckEntry[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const entry of cards) {
    used.set(entry.slug, (used.get(entry.slug) ?? 0) + entry.quantity);
  }
  return used;
}

/**
 * The pool of cards the player may add to their deck for `faction`: every slug
 * with at least one available copy that is faction-eligible, resolved to its
 * Card, tagged starter/reward/both, with how many copies the working `deck`
 * already uses. Sorted by type then name for stable display.
 */
export function availableCards(
  faction: StarterFaction,
  pool: readonly Card[],
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_name">[],
  deck: readonly DeckEntry[] = [],
): AvailableCard[] {
  const avail = computeAvailability(faction, owned);
  const baseline = starterBaseline(faction);
  const used = usedBySlug(deck);
  const bySlug = new Map(pool.map((c) => [c.slug, c]));

  const out: AvailableCard[] = [];
  for (const [slug, available] of avail) {
    if (available <= 0) continue;
    const card = bySlug.get(slug);
    if (card === undefined) continue;
    if (!isRewardEligible(card, faction)) continue;
    const fromStarter = (baseline.get(slug) ?? 0) > 0;
    const fromReward = available - (baseline.get(slug) ?? 0) > 0;
    const source: AvailableSource =
      fromStarter && fromReward ? "both" : fromStarter ? "starter" : "reward";
    out.push({ card, available, used: used.get(slug) ?? 0, source });
  }

  return out.sort((a, b) => {
    const byType = TYPE_ORDER[a.card.type] - TYPE_ORDER[b.card.type];
    return byType !== 0 ? byType : a.card.name.localeCompare(b.card.name);
  });
}

/**
 * Validates an active deck against the player's collection, collecting ALL
 * violations (never throws). Mirrors the spec deck rules:
 *   - exactly {@link STARTER_DECK_SIZE} cards (else `under`/`over`),
 *   - every slug must exist in the pool (`unknown`),
 *   - every card must be faction-eligible (`ineligible` — covers off-faction and
 *     Shaman via {@link isRewardEligible}),
 *   - per-slug quantity may not exceed available copies (`exceedsOwned`).
 * No hard per-card copy cap is imposed — owned quantity is the only limit.
 */
export function validateActiveDeck(
  cards: readonly DeckEntry[],
  faction: StarterFaction,
  pool: readonly Card[],
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_name">[],
): DeckValidation {
  const errors: DeckError[] = [];
  const size = deckSize(cards);
  if (size < STARTER_DECK_SIZE) errors.push({ kind: "under", size });
  else if (size > STARTER_DECK_SIZE) errors.push({ kind: "over", size });

  const avail = computeAvailability(faction, owned);
  const bySlug = new Map(pool.map((c) => [c.slug, c]));
  for (const [slug, used] of usedBySlug(cards)) {
    const card = bySlug.get(slug);
    if (card === undefined) {
      errors.push({ kind: "unknown", slug });
      continue;
    }
    if (!isRewardEligible(card, faction)) {
      errors.push({ kind: "ineligible", slug });
      continue;
    }
    const available = avail.get(slug) ?? 0;
    if (used > available) {
      errors.push({ kind: "exceedsOwned", slug, used, available });
    }
  }

  return { valid: errors.length === 0, size, errors };
}

/** The faction's starter recipe as a fresh, editable deck (spec "Reset"). */
export function starterActiveDeck(faction: StarterFaction): DeckEntry[] {
  return getRecipe(faction).cards.map((entry) => ({
    slug: entry.slug,
    quantity: entry.quantity,
  }));
}

/**
 * Expands deck entries into a flat Card[] for the simulator: each entry
 * contributes `quantity` copies of its Card. Throws if a slug is missing from
 * the pool, so a bad deck fails loudly rather than at game time.
 */
export function expandDeckEntries(
  entries: readonly DeckEntry[],
  pool: readonly Card[],
): Card[] {
  const bySlug = new Map(pool.map((c) => [c.slug, c]));
  const deck: Card[] = [];
  for (const { slug, quantity } of entries) {
    const card = bySlug.get(slug);
    if (card === undefined) {
      throw new Error(`Deck references unknown card slug "${slug}".`);
    }
    for (let i = 0; i < quantity; i++) deck.push(card);
  }
  return deck;
}

/** The active deck a player is actually using, and where it came from. */
export interface ChosenActiveDeck {
  readonly entries: DeckEntry[];
  /** True when a valid saved custom deck is in use. */
  readonly isCustom: boolean;
  /** True when a saved deck existed but was invalid, so we fell back. */
  readonly usedFallback: boolean;
  /** A message to surface when we fell back; absent otherwise. */
  readonly message?: string;
}

/**
 * Picks the deck to use for `faction`: the saved custom deck when it exists, is
 * for this faction, and is valid; otherwise the fixed starter deck. When a saved
 * deck exists but is invalid (or for the wrong faction), falls back to the
 * starter deck and reports a message (spec: clear fallback message).
 */
export function chooseActiveDeck(
  saved: ActiveDeckRecord | null,
  faction: StarterFaction,
  pool: readonly Card[],
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_name">[],
): ChosenActiveDeck {
  const starter = (): DeckEntry[] => starterActiveDeck(faction);
  if (saved === null) {
    return { entries: starter(), isCustom: false, usedFallback: false };
  }
  if (saved.faction !== faction) {
    return {
      entries: starter(),
      isCustom: false,
      usedFallback: true,
      message: "Your saved deck is for a different faction — using your starter deck.",
    };
  }
  const validation = validateActiveDeck(saved.cards, faction, pool, owned);
  if (validation.valid) {
    return {
      entries: saved.cards.map((e) => ({ slug: e.slug, quantity: e.quantity })),
      isCustom: true,
      usedFallback: false,
    };
  }
  return {
    entries: starter(),
    isCustom: false,
    usedFallback: true,
    message: "Your saved deck is no longer valid — using your starter deck.",
  };
}

/** Builds the active_decks upsert payload. Pure; pass `now` in tests. */
export function buildActiveDeckPayload(
  userId: string,
  faction: StarterFaction,
  cards: readonly DeckEntry[],
  now: Date = new Date(),
): ActiveDeckPayload {
  return {
    user_id: userId,
    faction,
    cards: cards.map((e) => ({ slug: e.slug, quantity: e.quantity })),
    updated_at: now.toISOString(),
  };
}

// --- Local (demo) persistence ----------------------------------------------

const STARTER_FACTION_VALUES: readonly string[] = STARTER_FACTIONS;

/** Narrows an unknown value to a DeckEntry[]. */
function isDeckEntryArray(value: unknown): value is DeckEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Record<string, unknown>)["slug"] === "string" &&
        typeof (e as Record<string, unknown>)["quantity"] === "number",
    )
  );
}

/** Narrows an unknown parsed value to an ActiveDeckRecord. */
function isActiveDeckRecord(value: unknown): value is ActiveDeckRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["faction"] === "string" &&
    STARTER_FACTION_VALUES.includes(v["faction"]) &&
    isDeckEntryArray(v["cards"]) &&
    typeof v["updated_at"] === "string"
  );
}

/** Reads the per-faction map of saved decks, or {} if absent/corrupt. */
function loadAllLocal(store: KeyValueStore): Record<string, ActiveDeckRecord> {
  const raw = store.getItem(ACTIVE_DECK_STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, ActiveDeckRecord> = {};
    for (const [faction, record] of Object.entries(parsed)) {
      if (isActiveDeckRecord(record)) out[faction] = record;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Coerces a raw Supabase `active_decks` row into a typed ActiveDeckRecord, or
 * null if the row is missing/malformed (bad faction or non-DeckEntry cards). The
 * Supabase backend uses this so a corrupt row degrades to the starter deck
 * rather than crashing.
 */
export function coerceActiveDeckRow(
  row: Record<string, unknown> | null,
): ActiveDeckRecord | null {
  if (row === null) return null;
  const faction = row["faction"];
  const cards = row["cards"];
  if (
    typeof faction !== "string" ||
    !STARTER_FACTION_VALUES.includes(faction) ||
    !isDeckEntryArray(cards)
  ) {
    return null;
  }
  const updatedAt = row["updated_at"];
  return {
    faction: faction as StarterFaction,
    cards: cards.map((e) => ({ slug: e.slug, quantity: e.quantity })),
    updated_at: typeof updatedAt === "string" ? updatedAt : new Date(0).toISOString(),
  };
}

/** Reads the saved local deck for one faction, or null if none/corrupt. */
export function loadLocalActiveDeck(
  store: KeyValueStore,
  faction: StarterFaction,
): ActiveDeckRecord | null {
  return loadAllLocal(store)[faction] ?? null;
}

/**
 * Saves one faction's active deck to local storage (the local mirror of the DB
 * upsert), stamping updated_at, and returns the stored record. Other factions'
 * saved decks are preserved.
 */
export function saveLocalActiveDeck(
  store: KeyValueStore,
  faction: StarterFaction,
  cards: readonly DeckEntry[],
  now: Date = new Date(),
): ActiveDeckRecord {
  const all = loadAllLocal(store);
  const record: ActiveDeckRecord = {
    faction,
    cards: cards.map((e) => ({ slug: e.slug, quantity: e.quantity })),
    updated_at: now.toISOString(),
  };
  all[faction] = record;
  store.setItem(ACTIVE_DECK_STORAGE_KEY, JSON.stringify(all));
  return record;
}
