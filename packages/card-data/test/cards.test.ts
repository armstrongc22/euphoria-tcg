import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardImagePath, loadCards, type Card } from "../src/index";

const cards: Card[] = loadCards();

describe("card database", () => {
  it("loads all 128 cards", () => {
    expect(cards).toHaveLength(128);
  });

  it("has a unique id on every card", () => {
    const ids = cards.map((card) => card.id);
    expect(new Set(ids).size).toBe(cards.length);
  });

  it("has a unique slug on every card", () => {
    const slugs = cards.map((card) => card.slug);
    expect(new Set(slugs).size).toBe(cards.length);
  });

  it("has id, slug, name, type, faction, cost, effectText, and imageFile on every card", () => {
    for (const card of cards) {
      expect(card.id, `id on ${card.name}`).toBeTruthy();
      expect(card.slug, `slug on ${card.id}`).toBeTruthy();
      expect(card.name, `name on ${card.id}`).toBeTruthy();
      expect(card.type, `type on ${card.id}`).toBeTruthy();
      expect(card.faction, `faction on ${card.id}`).toBeTruthy();
      expect(typeof card.cost, `cost on ${card.id}`).toBe("number");
      expect(card.cost, `cost on ${card.id}`).toBeGreaterThanOrEqual(0);
      // effectText is normalized to "" for vanilla cards with no rules text
      expect(typeof card.effectText, `effectText on ${card.id}`).toBe("string");
      expect(card.imageFile, `imageFile on ${card.id}`).toBeTruthy();
    }
  });

  it("resolves every imageFile to an existing PNG", () => {
    for (const card of cards) {
      expect(card.imageFile, `imageFile on ${card.id}`).toMatch(/\.png$/);
      expect(
        existsSync(cardImagePath(card.imageFile)),
        `missing image for ${card.id}: ${card.imageFile}`,
      ).toBe(true);
    }
  });
});
