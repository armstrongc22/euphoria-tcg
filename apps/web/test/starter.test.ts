/**
 * Starter recipe tests. These enforce the faction-identity rules on the frozen
 * recipes: an edit that smuggles in an off-faction Warrior, a Shaman card, or a
 * mismatched faction-specific Item fails here instead of shipping.
 */
import { describe, expect, it } from "vitest";
import { cards } from "../src/cards";
import {
  FACTION_SPECIFIC_ITEMS,
  STARTER_DECK_SIZE,
  STARTER_FACTIONS,
  STARTER_RECIPES,
  deckCardCount,
  getRecipe,
  resolveDeck,
  resolveFeatured,
} from "../src/starter";

const bySlug = new Map(cards.map((c) => [c.slug, c]));

describe("STARTER_RECIPES", () => {
  it("has exactly one recipe per playable faction", () => {
    expect(STARTER_RECIPES.map((r) => r.faction).sort()).toEqual(
      [...STARTER_FACTIONS].sort(),
    );
  });

  for (const faction of STARTER_FACTIONS) {
    describe(`${faction} starter deck`, () => {
      const recipe = getRecipe(faction);

      it("is exactly 30 cards", () => {
        expect(deckCardCount(recipe)).toBe(STARTER_DECK_SIZE);
      });

      it("uses positive integer quantities", () => {
        for (const entry of recipe.cards) {
          expect(Number.isInteger(entry.quantity)).toBe(true);
          expect(entry.quantity).toBeGreaterThan(0);
        }
      });

      it("lists each slug at most once", () => {
        const slugs = recipe.cards.map((e) => e.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      });

      it("resolves every slug to a real card", () => {
        // resolveDeck throws on an unknown slug; this also proves the count.
        const resolved = resolveDeck(recipe, cards);
        expect(resolved).toHaveLength(recipe.cards.length);
        expect(
          resolved.reduce((sum, e) => sum + e.quantity, 0),
        ).toBe(STARTER_DECK_SIZE);
      });

      it("only includes this faction's Warriors and Attacks", () => {
        for (const entry of recipe.cards) {
          const card = bySlug.get(entry.slug)!;
          if (card.type === "Warrior" || card.type === "Attack") {
            expect(card.faction).toBe(faction);
          }
        }
      });

      it("only includes Neutral Weapons and Items", () => {
        for (const entry of recipe.cards) {
          const card = bySlug.get(entry.slug)!;
          if (card.type === "Weapon" || card.type === "Item") {
            expect(card.faction).toBe("Neutral");
          }
        }
      });

      it("contains no Shaman cards", () => {
        for (const entry of recipe.cards) {
          expect(bySlug.get(entry.slug)!.faction).not.toBe("Shaman");
        }
      });

      it("only includes faction-specific Items that belong to this faction", () => {
        for (const entry of recipe.cards) {
          const owner = FACTION_SPECIFIC_ITEMS[entry.slug];
          if (owner !== undefined) {
            expect(owner).toBe(faction);
          }
        }
      });

      it("excludes every other faction's faction-specific Items", () => {
        const slugs = new Set(recipe.cards.map((e) => e.slug));
        for (const [slug, owner] of Object.entries(FACTION_SPECIFIC_ITEMS)) {
          if (owner !== faction) {
            expect(slugs.has(slug)).toBe(false);
          }
        }
      });

      it("features distinct cards from this faction", () => {
        const featured = resolveFeatured(recipe, cards);
        expect(featured.length).toBeGreaterThanOrEqual(3);
        expect(new Set(featured.map((c) => c.slug)).size).toBe(featured.length);
        for (const card of featured) {
          expect(card.faction).toBe(faction);
        }
      });
    });
  }
});

describe("FACTION_SPECIFIC_ITEMS", () => {
  it("maps only to real Neutral Items of the named faction's language", () => {
    for (const slug of Object.keys(FACTION_SPECIFIC_ITEMS)) {
      const card = bySlug.get(slug);
      expect(card, `unknown slug ${slug}`).toBeDefined();
      expect(card!.type).toBe("Item");
      expect(card!.faction).toBe("Neutral");
    }
  });

  it("classifies A Dragon's Judgement as Monk-specific", () => {
    expect(FACTION_SPECIFIC_ITEMS["a-dragons-judgement"]).toBe("Monk");
  });

  it("includes A Dragon's Judgement in the Monk deck and excludes it elsewhere", () => {
    for (const faction of STARTER_FACTIONS) {
      const has = getRecipe(faction).cards.some(
        (e) => e.slug === "a-dragons-judgement",
      );
      expect(has).toBe(faction === "Monk");
    }
  });

  it("treats the Greenskin Items as generic (not faction-specific)", () => {
    expect(FACTION_SPECIFIC_ITEMS["greenskin-auction-house"]).toBeUndefined();
    expect(FACTION_SPECIFIC_ITEMS["greenskin-kiln-co"]).toBeUndefined();
  });
});
