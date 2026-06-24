/**
 * Collection-based deck builder — pure logic: availability (starter baseline +
 * owned rewards), validation (size / eligibility / owned quantity), choosing the
 * active deck (starter default, valid custom, fallback), reset, and the
 * localStorage fallback. Pure/node — no DOM, no network.
 */
import { describe, expect, it } from "vitest";
import { cards } from "@euphoria/core/cards";
import { getRecipe, type DeckEntry } from "@euphoria/core/starter";
import {
  ACTIVE_DECK_STORAGE_KEY,
  availableCards,
  buildActiveDeckPayload,
  chooseActiveDeck,
  coerceActiveDeckRow,
  computeAvailability,
  deckSize,
  expandDeckEntries,
  loadLocalActiveDeck,
  saveLocalActiveDeck,
  starterActiveDeck,
  validateActiveDeck,
  type ActiveDeckRecord,
} from "../src/deck-builder";
import type { OwnedCardRecord } from "@euphoria/core/rewards";
import type { KeyValueStore } from "@euphoria/core/signup";

const LAHKT = "lahkt-brand-family-products"; // Neutral Item, Dwarf starter ×1

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Builds `n` owned-card rows for a slug (only the fields the builder reads). */
function owned(slug: string, n: number): Pick<OwnedCardRecord, "card_slug" | "card_name">[] {
  return Array.from({ length: n }, () => ({ card_slug: slug, card_name: slug }));
}

/** Returns a copy of `deck` with `slug`'s quantity set to `qty`. */
function setQty(deck: readonly DeckEntry[], slug: string, qty: number): DeckEntry[] {
  return deck.map((e) => (e.slug === slug ? { slug, quantity: qty } : { ...e }));
}

describe("starter deck is the default active deck (rule 1)", () => {
  it("chooseActiveDeck with no saved deck returns the starter deck", () => {
    const chosen = chooseActiveDeck(null, "Dwarf", cards, []);
    expect(chosen.isCustom).toBe(false);
    expect(chosen.usedFallback).toBe(false);
    expect(chosen.entries).toEqual(starterActiveDeck("Dwarf"));
    expect(deckSize(chosen.entries)).toBe(30);
  });
});

describe("saved custom deck is used when valid (rule 2)", () => {
  it("returns the saved deck as custom", () => {
    const saved: ActiveDeckRecord = {
      faction: "Dwarf",
      cards: starterActiveDeck("Dwarf"),
      updated_at: new Date().toISOString(),
    };
    const chosen = chooseActiveDeck(saved, "Dwarf", cards, []);
    expect(chosen.isCustom).toBe(true);
    expect(chosen.usedFallback).toBe(false);
    expect(chosen.entries).toEqual(saved.cards);
  });

  it("falls back to the starter deck when the saved deck is invalid", () => {
    const tooSmall = starterActiveDeck("Dwarf").slice(0, 5);
    const saved: ActiveDeckRecord = {
      faction: "Dwarf",
      cards: tooSmall,
      updated_at: new Date().toISOString(),
    };
    const chosen = chooseActiveDeck(saved, "Dwarf", cards, []);
    expect(chosen.isCustom).toBe(false);
    expect(chosen.usedFallback).toBe(true);
    expect(chosen.message).toBeDefined();
    expect(chosen.entries).toEqual(starterActiveDeck("Dwarf"));
  });

  it("falls back when the saved deck is for a different faction", () => {
    const saved: ActiveDeckRecord = {
      faction: "Monk",
      cards: starterActiveDeck("Monk"),
      updated_at: new Date().toISOString(),
    };
    const chosen = chooseActiveDeck(saved, "Dwarf", cards, []);
    expect(chosen.usedFallback).toBe(true);
    expect(chosen.entries).toEqual(starterActiveDeck("Dwarf"));
  });
});

describe("deck must be exactly 30 cards (rule 3)", () => {
  it("passes at 30 and flags under/over", () => {
    const starter = starterActiveDeck("Dwarf");
    expect(validateActiveDeck(starter, "Dwarf", cards, []).valid).toBe(true);

    const under = starter.slice(0, starter.length - 1); // drop a 1-of → 29
    const underResult = validateActiveDeck(under, "Dwarf", cards, []);
    expect(underResult.size).toBe(29);
    expect(underResult.errors).toContainEqual({ kind: "under", size: 29 });

    const over = setQty(starter, "titan", 3); // titan 2→3 → 31
    const overResult = validateActiveDeck(over, "Dwarf", cards, []);
    expect(overResult.size).toBe(31);
    expect(overResult.errors).toContainEqual({ kind: "over", size: 31 });
  });
});

describe("cannot exceed owned quantity (rules 6, 10)", () => {
  it("flags exceedsOwned when a slug exceeds available copies", () => {
    // lahkt baseline 1; use 2 with none owned. Keep size 30 by dropping a titan.
    let deck = setQty(starterActiveDeck("Dwarf"), LAHKT, 2);
    deck = setQty(deck, "titan", 1);
    expect(deckSize(deck)).toBe(30);
    const result = validateActiveDeck(deck, "Dwarf", cards, []);
    expect(result.errors).toContainEqual({
      kind: "exceedsOwned",
      slug: LAHKT,
      used: 2,
      available: 1,
    });
  });
});

describe("reward inventory increases available quantity (rules 5, 9)", () => {
  it("adds owned reward copies to the starter baseline", () => {
    const avail = computeAvailability("Dwarf", owned(LAHKT, 5));
    expect(avail.get(LAHKT)).toBe(6); // baseline 1 + 5 earned

    // The lahkt-2 deck that was invalid with 0 owned is now valid with 1 owned.
    let deck = setQty(starterActiveDeck("Dwarf"), LAHKT, 2);
    deck = setQty(deck, "titan", 1);
    expect(validateActiveDeck(deck, "Dwarf", cards, owned(LAHKT, 1)).valid).toBe(true);
  });

  it("surfaces reward-only cards in the available pool", () => {
    // aaron-alacapati is a Dwarf Warrior in the starter (baseline 2); a rewarded
    // Dwarf card not in the starter shows as a reward source.
    const rewardSlug = "ajax"; // Dwarf Warrior, starter ×1
    const pool = availableCards("Dwarf", cards, owned(rewardSlug, 3));
    const ajax = pool.find((c) => c.card.slug === rewardSlug);
    expect(ajax?.available).toBe(1 + 3); // starter 1 + 3 reward
    expect(ajax?.source).toBe("both");
  });
});

describe("faction-ineligible and Shaman cards are rejected (rules 3,4,5,7)", () => {
  it("rejects an off-faction Warrior", () => {
    let deck = setQty(starterActiveDeck("Dwarf"), "titan", 1); // 30→29
    deck = [...deck, { slug: "blaize-azazel", quantity: 1 }]; // Monk Warrior → 30
    const result = validateActiveDeck(deck, "Dwarf", cards, []);
    expect(result.errors).toContainEqual({ kind: "ineligible", slug: "blaize-azazel" });
  });

  it("rejects a Shaman card", () => {
    let deck = setQty(starterActiveDeck("Dwarf"), "titan", 1);
    deck = [...deck, { slug: "augustine", quantity: 1 }]; // Shaman Warrior → 30
    const result = validateActiveDeck(deck, "Dwarf", cards, []);
    expect(result.errors).toContainEqual({ kind: "ineligible", slug: "augustine" });
  });

  it("never surfaces a Shaman card in the available pool", () => {
    const pool = availableCards("Dwarf", cards, owned("augustine", 2));
    expect(pool.some((c) => c.card.slug === "augustine")).toBe(false);
  });
});

describe("reset to starter deck (rule UI-6)", () => {
  it("starterActiveDeck equals the frozen recipe and validates", () => {
    const reset = starterActiveDeck("Dwarf");
    expect(reset).toEqual(getRecipe("Dwarf").cards.map((e) => ({ ...e })));
    expect(validateActiveDeck(reset, "Dwarf", cards, []).valid).toBe(true);
  });
});

describe("localStorage fallback (rule persistence-4)", () => {
  it("round-trips a saved deck per faction", () => {
    const store = memoryStore();
    const deck = starterActiveDeck("Dwarf");
    saveLocalActiveDeck(store, "Dwarf", deck);
    saveLocalActiveDeck(store, "Monk", starterActiveDeck("Monk"));

    const loaded = loadLocalActiveDeck(store, "Dwarf");
    expect(loaded?.faction).toBe("Dwarf");
    expect(loaded?.cards).toEqual(deck);
    // Other faction is preserved independently.
    expect(loadLocalActiveDeck(store, "Monk")?.faction).toBe("Monk");
    // A faction with nothing saved is null.
    expect(loadLocalActiveDeck(store, "Sonic")).toBeNull();
  });

  it("returns null on corrupt storage", () => {
    const store = memoryStore();
    store.setItem(ACTIVE_DECK_STORAGE_KEY, "{not json");
    expect(loadLocalActiveDeck(store, "Dwarf")).toBeNull();
  });

  it("coerceActiveDeckRow rejects malformed rows", () => {
    expect(coerceActiveDeckRow(null)).toBeNull();
    expect(coerceActiveDeckRow({ faction: "Ogre", cards: [] })).toBeNull();
    expect(coerceActiveDeckRow({ faction: "Dwarf", cards: "nope" })).toBeNull();
    const ok = coerceActiveDeckRow({
      faction: "Dwarf",
      cards: [{ slug: LAHKT, quantity: 1 }],
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(ok?.faction).toBe("Dwarf");
  });
});

describe("payload builder", () => {
  it("builds the active_decks upsert payload", () => {
    const now = new Date("2026-06-16T12:00:00.000Z");
    const payload = buildActiveDeckPayload("user-1", "Dwarf", starterActiveDeck("Dwarf"), now);
    expect(payload).toMatchObject({
      user_id: "user-1",
      faction: "Dwarf",
      updated_at: "2026-06-16T12:00:00.000Z",
    });
    expect(deckSize(payload.cards)).toBe(30);
  });
});

describe("expandDeckEntries", () => {
  it("expands entries into a flat 30-card list", () => {
    const flat = expandDeckEntries(starterActiveDeck("Dwarf"), cards);
    expect(flat).toHaveLength(30);
  });

  it("throws on an unknown slug", () => {
    expect(() => expandDeckEntries([{ slug: "nope", quantity: 1 }], cards)).toThrow();
  });
});
