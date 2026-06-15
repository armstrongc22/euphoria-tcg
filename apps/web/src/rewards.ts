/**
 * Reward cards — PURE logic, no DOM, no network. Three concerns:
 *
 *   1. Eligibility + generation: which cards a player may be offered for their
 *      faction (isRewardEligible / eligibleRewardCards) and picking 3 distinct
 *      options from that pool (generateRewardOptions). Deterministic given an rng.
 *   2. Persistence payloads: turning a chosen Card into the rows we write to the
 *      `owned_cards` and `reward_events` tables (buildOwnedCardInsert /
 *      buildRewardEventInsert), plus the inventory stats shown on the account
 *      page (computeInventoryStats / groupOwnedBySlug).
 *   3. The LOCAL/DEMO persistence layer used when Supabase isn't configured, so
 *      the demo still earns and shows reward cards. Storage is injected via
 *      {@link KeyValueStore} so it's fully unit-testable without a browser.
 *
 * This is beta progression, not an economy: card DATA, the frozen starter
 * recipes, and the simulator are all untouched — rewards only ever read the
 * existing card pool and the faction-eligibility rules already used by starter
 * decks (FACTION_SPECIFIC_ITEMS in ./starter).
 */
import type { Card, CardType, Faction } from "@euphoria/card-data/schema";
import type { KeyValueStore } from "./signup";
import { FACTION_SPECIFIC_ITEMS, type StarterFaction } from "./starter";

/** How many reward options a player chooses between after a match. */
export const REWARD_OPTION_COUNT = 3;

/** localStorage keys. Versioned so the shape can change later without clashes. */
export const OWNED_STORAGE_KEY = "euphoria.owned.v1";
export const REWARD_EVENTS_STORAGE_KEY = "euphoria.rewardEvents.v1";

/** Where an owned card came from. Only rewards exist in the beta. */
export type OwnedCardSource = "reward";

/**
 * Is `card` allowed as a reward for a player who chose `faction`? The rule
 * mirrors the starter-deck faction-identity rules (see ./starter):
 *
 *   - the faction's own Warriors and Attacks — allowed,
 *   - generic Neutral cards (Items + Weapons) — allowed in any deck,
 *   - a faction-specific Neutral Item — allowed ONLY for its mapped faction,
 *   - Shaman cards — never (no Shaman rewards in the beta),
 *   - any other faction's faction cards — never.
 */
export function isRewardEligible(card: Card, faction: StarterFaction): boolean {
  if (card.faction === "Shaman") return false;
  if (card.faction === faction) return true;
  if (card.faction === "Neutral") {
    const owner = FACTION_SPECIFIC_ITEMS[card.slug];
    return owner === undefined || owner === faction;
  }
  return false;
}

/**
 * Every card eligible as a reward for `faction`, sorted by slug so the pool is
 * deterministic (generation then shuffles a copy with the passed rng).
 */
export function eligibleRewardCards(
  faction: StarterFaction,
  pool: readonly Card[],
): Card[] {
  return pool
    .filter((card) => isRewardEligible(card, faction))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Picks `count` distinct reward options for `faction` from the eligible pool.
 * Deterministic for a given rng (a seeded Fisher–Yates over the sorted pool),
 * so a seed reproduces the same offer. Returns fewer than `count` only if the
 * eligible pool is smaller (it never is for the four starter factions).
 */
export function generateRewardOptions(
  faction: StarterFaction,
  pool: readonly Card[],
  rng: () => number,
  count: number = REWARD_OPTION_COUNT,
): Card[] {
  const eligible = eligibleRewardCards(faction, pool);
  // Partial Fisher–Yates: shuffle only the first `take` slots, then slice.
  const take = Math.min(count, eligible.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (eligible.length - i));
    const tmp = eligible[i]!;
    eligible[i] = eligible[j]!;
    eligible[j] = tmp;
  }
  return eligible.slice(0, take);
}

// --- Persistence payloads --------------------------------------------------

/** Columns inserted into `owned_cards` per acquired card. */
export interface OwnedCardInsert {
  readonly user_id: string;
  readonly card_slug: string;
  readonly card_name: string;
  readonly faction: Faction;
  readonly card_type: CardType;
  readonly source: OwnedCardSource;
}

/** A persisted owned-card row: the inserted columns plus the DB/local stamp. */
export interface OwnedCardRecord extends OwnedCardInsert {
  readonly created_at: string;
}

/** Columns inserted into `reward_events` per reward choice. */
export interface RewardEventInsert {
  readonly user_id: string;
  readonly player_faction: StarterFaction;
  /** The slug the player chose. */
  readonly chosen_slug: string;
  /** All slugs that were offered (includes chosen_slug). */
  readonly option_slugs: readonly string[];
}

/**
 * Builds the owned_cards insert for a chosen reward card. Pure; `created_at` is
 * omitted because the DB default (and the local layer) set it on insert.
 */
export function buildOwnedCardInsert(
  userId: string,
  card: Card,
  source: OwnedCardSource = "reward",
): OwnedCardInsert {
  return {
    user_id: userId,
    card_slug: card.slug,
    card_name: card.name,
    faction: card.faction,
    card_type: card.type,
    source,
  };
}

/** Builds the reward_events insert recording which option was chosen. */
export function buildRewardEventInsert(
  userId: string,
  faction: StarterFaction,
  options: readonly Card[],
  chosen: Card,
): RewardEventInsert {
  return {
    user_id: userId,
    player_faction: faction,
    chosen_slug: chosen.slug,
    option_slugs: options.map((c) => c.slug),
  };
}

// --- Inventory stats -------------------------------------------------------

/** Aggregate inventory stats shown on the account page. */
export interface InventoryStats {
  /** Total reward cards owned (counts duplicates). */
  readonly total: number;
  /** Distinct card slugs owned. */
  readonly unique: number;
  /** Counts per card type; types with none are omitted. */
  readonly byType: Readonly<Partial<Record<CardType, number>>>;
}

/** Empty stats for a player who hasn't earned any reward cards yet. */
export const EMPTY_INVENTORY_STATS: InventoryStats = {
  total: 0,
  unique: 0,
  byType: {},
};

/** Tallies totals, distinct slugs, and per-type counts over owned rows. */
export function computeInventoryStats(
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_type">[],
): InventoryStats {
  const slugs = new Set<string>();
  const byType: Partial<Record<CardType, number>> = {};
  for (const row of owned) {
    slugs.add(row.card_slug);
    byType[row.card_type] = (byType[row.card_type] ?? 0) + 1;
  }
  return { total: owned.length, unique: slugs.size, byType };
}

/** One grouped inventory line: a slug owned `count` times, with its name. */
export interface OwnedGroup {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

/**
 * Groups owned rows by slug for display: name + how many copies are owned,
 * sorted by name. Newest acquisition wins the displayed name (rows are assumed
 * newest-first), though names are stable per slug anyway.
 */
export function groupOwnedBySlug(
  owned: readonly Pick<OwnedCardRecord, "card_slug" | "card_name">[],
): OwnedGroup[] {
  const groups = new Map<string, OwnedGroup>();
  for (const row of owned) {
    const existing = groups.get(row.card_slug);
    if (existing === undefined) {
      groups.set(row.card_slug, {
        slug: row.card_slug,
        name: row.card_name,
        count: 1,
      });
    } else {
      groups.set(row.card_slug, { ...existing, count: existing.count + 1 });
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Local (demo) persistence ----------------------------------------------

const STARTER_FACTION_VALUES: readonly string[] = [
  "Dwarf",
  "Monk",
  "Sonic",
  "Surfer",
];
const FACTION_VALUES: readonly string[] = [
  ...STARTER_FACTION_VALUES,
  "Shaman",
  "Neutral",
];
const CARD_TYPE_VALUES: readonly string[] = [
  "Warrior",
  "Attack",
  "Item",
  "Weapon",
];

/** Narrows an unknown parsed value to an OwnedCardRecord, dropping anything bad. */
function isOwnedCardRecord(value: unknown): value is OwnedCardRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["user_id"] === "string" &&
    typeof v["card_slug"] === "string" &&
    typeof v["card_name"] === "string" &&
    typeof v["faction"] === "string" &&
    FACTION_VALUES.includes(v["faction"]) &&
    typeof v["card_type"] === "string" &&
    CARD_TYPE_VALUES.includes(v["card_type"]) &&
    typeof v["source"] === "string" &&
    typeof v["created_at"] === "string"
  );
}

/** Reads persisted local owned cards, or [] if absent/corrupt. Never throws. */
export function loadLocalOwned(store: KeyValueStore): OwnedCardRecord[] {
  const raw = store.getItem(OWNED_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOwnedCardRecord);
  } catch {
    return [];
  }
}

/**
 * Appends one owned card to local storage, stamping created_at (the local
 * mirror of the DB default), and returns the stored record.
 */
export function appendLocalOwned(
  store: KeyValueStore,
  insert: OwnedCardInsert,
  now: Date = new Date(),
): OwnedCardRecord {
  const record: OwnedCardRecord = { ...insert, created_at: now.toISOString() };
  const all = loadLocalOwned(store);
  all.push(record);
  store.setItem(OWNED_STORAGE_KEY, JSON.stringify(all));
  return record;
}

/**
 * Appends one reward event to local storage. We don't read these back in the
 * UI (the inventory comes from owned_cards), but persisting them locally keeps
 * the demo flow faithful to the Supabase path, which writes both tables.
 */
export function appendLocalRewardEvent(
  store: KeyValueStore,
  insert: RewardEventInsert,
  now: Date = new Date(),
): void {
  const record = { ...insert, created_at: now.toISOString() };
  let all: unknown[] = [];
  const raw = store.getItem(REWARD_EVENTS_STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) all = parsed;
    } catch {
      all = [];
    }
  }
  all.push(record);
  store.setItem(REWARD_EVENTS_STORAGE_KEY, JSON.stringify(all));
}
