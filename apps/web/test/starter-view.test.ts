/**
 * @vitest-environment jsdom
 *
 * Starter Decks render tests. Proves the UI logic can build a deck panel for
 * every faction: one row per recipe line, with quantity, name, type, and an
 * image for each card, plus the featured spotlight and the upgrades teaser.
 */
import { describe, expect, it } from "vitest";
import { cards } from "../src/cards";
import { renderDeckPanel } from "../src/starter-view";
import { STARTER_FACTIONS, getRecipe } from "../src/starter";

describe("renderDeckPanel", () => {
  for (const faction of STARTER_FACTIONS) {
    describe(faction, () => {
      const panel = renderDeckPanel(faction, cards);

      it("renders one deck row per recipe line, each with art", () => {
        const recipe = getRecipe(faction);
        const rows = panel.querySelectorAll(".deck-row");
        expect(rows).toHaveLength(recipe.cards.length);
        for (const row of rows) {
          expect(row.querySelector(".deck-row__qty")?.textContent).toMatch(/^\d+×$/);
          expect(row.querySelector(".deck-row__name")?.textContent).toBeTruthy();
          expect(row.querySelector(".deck-row__type")?.textContent).toContain("·");
          expect(row.querySelector("img.deck-row__art")).not.toBeNull();
        }
      });

      it("renders the featured spotlight", () => {
        const featured = panel.querySelectorAll(".starter-featured__card");
        expect(featured.length).toBe(getRecipe(faction).featured.length);
        for (const card of featured) {
          expect(card.querySelector("img")).not.toBeNull();
          expect(card.querySelector("figcaption")?.textContent).toBeTruthy();
        }
      });

      it("renders the upgrades teaser mentioning progression", () => {
        const teaser = panel.querySelector(".starter-teaser");
        expect(teaser).not.toBeNull();
        expect(teaser?.textContent?.toLowerCase()).toContain("progression");
      });
    });
  }
});
