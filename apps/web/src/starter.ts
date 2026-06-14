/**
 * Starter decks: fixed, curated 30-card recipes for the four playable factions.
 *
 * These are NOT regenerated at runtime. Each recipe is an explicit list of card
 * slugs + quantities so the deck a player chooses is stable and named — the
 * baseline that reward-card progression will later upgrade from. The simulator's
 * `buildFactionDeck` (apps/simulator) was used as a starting point, but it samples
 * randomly and does not enforce the faction-identity rules below, so the lists
 * here are hand-curated and frozen.
 *
 * Faction-identity rules each recipe obeys:
 *   - Warriors and Attacks: only from the deck's own faction.
 *   - Weapons: Neutral only (all Weapons are Neutral and generic).
 *   - Items: generic Neutral Items (no faction-specific language) are allowed in
 *     any deck; a faction-specific Neutral Item (one whose text targets a named
 *     faction's Warriors) is allowed ONLY in that faction's deck.
 *   - Never: other-faction Warriors/Attacks, Shaman cards, or a Neutral Item that
 *     references a different faction.
 *
 * This module is pure (no DOM) so the rules above can be unit-tested.
 */
import type { Card } from "@euphoria/card-data/schema";

export const STARTER_FACTIONS = ["Dwarf", "Monk", "Sonic", "Surfer"] as const;
export type StarterFaction = (typeof STARTER_FACTIONS)[number];

/** Every starter deck is exactly this many cards. */
export const STARTER_DECK_SIZE = 30;

/** One line in a recipe: a card slug and how many copies the deck runs. */
export interface DeckEntry {
  readonly slug: string;
  readonly quantity: number;
}

/** A frozen starter deck plus the flavor/playstyle copy shown in the UI. */
export interface StarterRecipe {
  readonly faction: StarterFaction;
  /** Short flavor text. */
  readonly flavor: string;
  /** One-line playstyle summary. */
  readonly playstyle: string;
  /** A few signature card slugs to spotlight. */
  readonly featured: readonly string[];
  /** The explicit deck list: slug + quantity, summing to STARTER_DECK_SIZE. */
  readonly cards: readonly DeckEntry[];
}

/**
 * Neutral Items whose rules text targets a specific faction's Warriors, mapped
 * to the faction that owns them. A faction-specific Item may appear ONLY in its
 * mapped faction's starter deck. Items absent from this map are treated as
 * generic and allowed anywhere.
 *
 * Previously-borderline cases, now resolved (the rule is mechanical rules text,
 * not name/flavor):
 *   - "a-dragons-judgement": text reads "any Warrior that attacks a Monk loses
 *     1000 HEALTH" — it explicitly references Monk, so it is Monk-specific and
 *     appears only in the Monk starter deck.
 *   - "greenskin-auction-house" / "greenskin-kiln-co": Dwarf-flavored *names*
 *     ("Greenskin"), but their effect text is mechanically generic ("Add 1 Weapon
 *     ..."). They are treated as generic and eligible for any deck, unless card
 *     data later makes them Dwarf-specific.
 */
export const FACTION_SPECIFIC_ITEMS: Readonly<Record<string, StarterFaction>> = {
  "anansis-highway": "Dwarf", // "Add 1 Dwarf Warrior to your hand."
  "reliable-henchmen": "Dwarf", // "Add 1 Dwarf Warrior to your hand."
  "orange-court": "Dwarf", // "opponent cannot attack Dwarf Warriors ..."
  "choir-of-pyrois": "Monk", // "Choose 1 Monk Warrior ... attack twice ..."
  "flame-training": "Monk", // "All Monk Warriors ... gain 500 ATTACK ..."
  "pyro-bokor": "Monk", // "Add 1 Monk Attack or Monk Warrior card ..."
  "a-dragons-judgement": "Monk", // names Monk (flagged; unused — see note above)
  "heavens-door-izakaya": "Sonic", // "all Sonic Warriors ... gain 1000 ATTACK ..."
};

/**
 * The four frozen starter recipes. Each sums to STARTER_DECK_SIZE; the tests in
 * starter.test.ts enforce the size and faction-identity rules, so an edit that
 * breaks a rule fails loudly instead of shipping.
 */
export const STARTER_RECIPES: readonly StarterRecipe[] = [
  {
    faction: "Dwarf",
    flavor:
      "Mountain-born and immovable. The Dwarves of the Highstone clans meet every storm with a deeper wall and a heavier fist.",
    playstyle:
      "Grindy and resilient — fat HEALTH Warriors hold the line while you build Spirit and out-last the opponent.",
    featured: ["atlas-alacapati", "titan", "durga-highstone"],
    cards: [
      { slug: "aaron-alacapati", quantity: 2 },
      { slug: "ajax", quantity: 1 },
      { slug: "atlas-alacapati", quantity: 1 },
      { slug: "bliss-valentine", quantity: 1 },
      { slug: "durga-highstone", quantity: 2 },
      { slug: "exodus-st-claire", quantity: 1 },
      { slug: "freight-train", quantity: 1 },
      { slug: "gulag", quantity: 1 },
      { slug: "nyx-highstone", quantity: 1 },
      { slug: "prosperity", quantity: 1 },
      { slug: "the-terra-twins", quantity: 1 },
      { slug: "titan", quantity: 2 },
      { slug: "troy-chasm", quantity: 1 },
      { slug: "tun-centree", quantity: 1 },
      { slug: "invictius-durango", quantity: 1 },
      { slug: "apex-forest", quantity: 1 },
      { slug: "guatavita", quantity: 1 },
      { slug: "oak-splitter-5x", quantity: 1 },
      { slug: "silurian-period", quantity: 1 },
      { slug: "fairys-treasure-chest", quantity: 1 },
      { slug: "fafnir", quantity: 1 },
      { slug: "scythe-cycle", quantity: 1 },
      { slug: "lahkt-brand-family-products", quantity: 1 },
      { slug: "totems-creation", quantity: 1 },
      { slug: "gils-unit", quantity: 1 },
      { slug: "anansis-highway", quantity: 1 },
      { slug: "orange-court", quantity: 1 },
    ],
  },
  {
    faction: "Monk",
    flavor:
      "Disciplined keepers of the inner flame. The Monks turn devotion into fire and patience into ruin.",
    playstyle:
      "Aggressive tempo — pump Monk ATTACK with Items and weapons, then strike before the board can answer.",
    featured: ["jiaohui-zhong", "gouhuo-yongheng", "emo"],
    cards: [
      { slug: "blaize-azazel", quantity: 1 },
      { slug: "diyu-shang", quantity: 1 },
      { slug: "gouhuo-yongheng", quantity: 1 },
      { slug: "hades-ceru", quantity: 1 },
      { slug: "haifa-morningstar", quantity: 1 },
      { slug: "hideon", quantity: 1 },
      { slug: "huoyan-ying", quantity: 1 },
      { slug: "jiaohui-zhong", quantity: 2 },
      { slug: "juan-feng", quantity: 1 },
      { slug: "knight-gradi", quantity: 1 },
      { slug: "liuxing", quantity: 1 },
      { slug: "oog", quantity: 1 },
      { slug: "warden-arcane", quantity: 1 },
      { slug: "xian", quantity: 1 },
      { slug: "emo", quantity: 1 },
      { slug: "hope-cyrus", quantity: 2 },
      { slug: "7th-plague", quantity: 1 },
      { slug: "dantes-lamentation", quantity: 1 },
      { slug: "gylippus", quantity: 2 },
      { slug: "fairys-treasure-chest", quantity: 1 },
      { slug: "jesus", quantity: 1 },
      { slug: "fafnir", quantity: 1 },
      { slug: "lahkt-brand-family-products", quantity: 1 },
      { slug: "totems-creation", quantity: 1 },
      { slug: "choir-of-pyrois", quantity: 1 },
      { slug: "flame-training", quantity: 1 },
      { slug: "a-dragons-judgement", quantity: 1 },
    ],
  },
  {
    faction: "Sonic",
    flavor:
      "Fast, loud, and merciless. The Sonic vanguard moves faster than the eye and hits before the ear can warn.",
    playstyle:
      "High-tempo beatdown — cheap aggressive Warriors and ATTACK buffs race the opponent's life total down.",
    featured: ["titus", "yojimbo", "brut"],
    cards: [
      { slug: "bit-schneider", quantity: 1 },
      { slug: "brut", quantity: 2 },
      { slug: "carlson", quantity: 1 },
      { slug: "cassidy-sinclair", quantity: 1 },
      { slug: "high-councilor-jerome-baldwin", quantity: 1 },
      { slug: "kit", quantity: 1 },
      { slug: "lynn-katabatic", quantity: 2 },
      { slug: "priest-aquinas", quantity: 1 },
      { slug: "raigi", quantity: 1 },
      { slug: "sunourufu", quantity: 1 },
      { slug: "titus", quantity: 2 },
      { slug: "tristin-dangan", quantity: 1 },
      { slug: "warden-babylon", quantity: 1 },
      { slug: "yojimbo", quantity: 2 },
      { slug: "cytotoxic-chapel", quantity: 1 },
      { slug: "megawatt-apocalypse", quantity: 1 },
      { slug: "pisubaipa", quantity: 1 },
      { slug: "saranyus-armory", quantity: 1 },
      { slug: "fairys-treasure-chest", quantity: 1 },
      { slug: "scythe-cycle", quantity: 1 },
      { slug: "ontology", quantity: 1 },
      { slug: "lahkt-brand-family-products", quantity: 1 },
      { slug: "totems-creation", quantity: 1 },
      { slug: "gils-unit", quantity: 1 },
      { slug: "heavens-door-izakaya", quantity: 1 },
      { slug: "cryraven-circus", quantity: 1 },
    ],
  },
  {
    faction: "Surfer",
    flavor:
      "Tide-readers and storm-chasers. The Surfers bend the ocean's patience into overwhelming pressure.",
    playstyle:
      "Flexible midrange — durable Warriors and tempo Attacks let you trade, stall, and ride momentum to the win.",
    featured: ["kaltvatten", "okee", "freia-renvatten"],
    cards: [
      { slug: "alluvium", quantity: 1 },
      { slug: "aur-neolin", quantity: 1 },
      { slug: "captain-cold-rain-kai", quantity: 1 },
      { slug: "chiup-flowiktu", quantity: 1 },
      { slug: "countess-kalix", quantity: 1 },
      { slug: "delta-renvatten", quantity: 2 },
      { slug: "fen-larkin", quantity: 1 },
      { slug: "freia-renvatten", quantity: 2 },
      { slug: "haito", quantity: 1 },
      { slug: "kade-ritz", quantity: 1 },
      { slug: "kaltvatten", quantity: 2 },
      { slug: "mark-lee-fathom", quantity: 1 },
      { slug: "okee", quantity: 2 },
      { slug: "pandora-the-island-eater", quantity: 1 },
      { slug: "bitter-guard", quantity: 1 },
      { slug: "floe-breaker", quantity: 1 },
      { slug: "serfs-bondage", quantity: 2 },
      { slug: "fairys-treasure-chest", quantity: 1 },
      { slug: "fafnir", quantity: 1 },
      { slug: "ontology", quantity: 1 },
      { slug: "lahkt-brand-family-products", quantity: 1 },
      { slug: "totems-creation", quantity: 1 },
      { slug: "gils-unit", quantity: 1 },
      { slug: "cryraven-circus", quantity: 1 },
      { slug: "gunder-love", quantity: 1 },
    ],
  },
];

/** A resolved deck line: the real Card plus how many copies the deck runs. */
export interface ResolvedDeckEntry {
  readonly card: Card;
  readonly quantity: number;
}

/** Total number of cards a recipe runs (sum of quantities). */
export function deckCardCount(recipe: StarterRecipe): number {
  return recipe.cards.reduce((sum, entry) => sum + entry.quantity, 0);
}

/** Looks up the recipe for a faction, or throws if there isn't one. */
export function getRecipe(faction: StarterFaction): StarterRecipe {
  const recipe = STARTER_RECIPES.find((r) => r.faction === faction);
  if (recipe === undefined) {
    throw new Error(`No starter recipe for faction "${faction}".`);
  }
  return recipe;
}

/**
 * Resolves a recipe's slugs against the card pool, preserving recipe order.
 * Throws if any slug is missing, so a typo in a recipe fails loudly rather than
 * silently dropping a card.
 */
export function resolveDeck(
  recipe: StarterRecipe,
  pool: readonly Card[],
): ResolvedDeckEntry[] {
  const bySlug = new Map(pool.map((c) => [c.slug, c]));
  return recipe.cards.map((entry) => {
    const card = bySlug.get(entry.slug);
    if (card === undefined) {
      throw new Error(
        `Recipe "${recipe.faction}" references unknown card slug "${entry.slug}".`,
      );
    }
    return { card, quantity: entry.quantity };
  });
}

/** Resolves a recipe's featured slugs to cards, in featured order. */
export function resolveFeatured(
  recipe: StarterRecipe,
  pool: readonly Card[],
): Card[] {
  const bySlug = new Map(pool.map((c) => [c.slug, c]));
  return recipe.featured.map((slug) => {
    const card = bySlug.get(slug);
    if (card === undefined) {
      throw new Error(
        `Recipe "${recipe.faction}" features unknown card slug "${slug}".`,
      );
    }
    return card;
  });
}
