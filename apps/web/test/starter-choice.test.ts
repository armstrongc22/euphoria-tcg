/**
 * @vitest-environment jsdom
 *
 * Starter-deck selection flow: the choosing screen shows one floating product
 * card per faction (name, playstyle, featured art, "Choose this deck"), and
 * choosing one fires onChoose and reveals that faction's fixed 30-card list,
 * which still resolves to a valid deck.
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "@euphoria/core/cards";
import { mountStarterDecks, renderFactionChoice } from "../src/starter-view";
import {
  STARTER_DECK_SIZE,
  STARTER_FACTIONS,
  getRecipe,
} from "@euphoria/core/starter";

describe("renderFactionChoice", () => {
  for (const faction of STARTER_FACTIONS) {
    it(`renders ${faction} as a product card with featured art and a CTA`, () => {
      const recipe = getRecipe(faction);
      const onChoose = vi.fn();
      const el = renderFactionChoice(recipe, cards, onChoose);

      expect(el.dataset.faction).toBe(faction);
      expect(el.querySelector(".faction-choice__name")?.textContent).toBe(faction);
      expect(el.querySelector(".faction-choice__playstyle")?.textContent).toContain(
        recipe.playstyle,
      );
      // 2-3 featured images.
      const thumbs = el.querySelectorAll("img.faction-choice__thumb");
      expect(thumbs.length).toBeGreaterThanOrEqual(2);
      expect(thumbs.length).toBeLessThanOrEqual(3);

      const cta = el.querySelector<HTMLButtonElement>(".faction-choice__cta")!;
      expect(cta.textContent).toContain("Choose this deck");
      cta.click();
      expect(onChoose).toHaveBeenCalledWith(faction);
    });
  }
});

describe("mountStarterDecks", () => {
  it("starts on the choosing screen with one card per faction", () => {
    const root = document.createElement("div");
    mountStarterDecks(root, cards);

    const choices = root.querySelectorAll(".faction-choice");
    expect(choices).toHaveLength(STARTER_FACTIONS.length);
    expect(root.querySelector("#starter-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("choosing a deck fires onChoose and shows that valid 30-card deck", () => {
    const root = document.createElement("div");
    const onChoose = vi.fn();
    mountStarterDecks(root, cards, { onChoose });

    const sonicCta = root.querySelector<HTMLButtonElement>(
      '.faction-choice__cta[data-faction="Sonic"]',
    )!;
    sonicCta.click();

    // First-time pick: committed immediately, no progression reset.
    expect(onChoose).toHaveBeenCalledWith("Sonic", { resetProgression: false });

    const panel = root.querySelector<HTMLElement>("#starter-panel")!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".deck-panel")?.getAttribute("data-faction")).toBe(
      "Sonic",
    );

    // The rendered list reflects the frozen 30-card recipe.
    const rows = panel.querySelectorAll(".deck-row");
    const recipe = getRecipe("Sonic");
    expect(rows).toHaveLength(recipe.cards.length);
    const total = recipe.cards.reduce((sum, e) => sum + e.quantity, 0);
    expect(total).toBe(STARTER_DECK_SIZE);
  });

  it("opens straight to the chosen deck when initialFaction is set", () => {
    const root = document.createElement("div");
    mountStarterDecks(root, cards, { initialFaction: "Dwarf" });

    const panel = root.querySelector<HTMLElement>("#starter-panel")!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".deck-panel")?.getAttribute("data-faction")).toBe(
      "Dwarf",
    );
    // Choices are hidden until "Choose a different deck" is clicked.
    expect(root.querySelector("#starter-choices")?.hasAttribute("hidden")).toBe(
      true,
    );

    root.querySelector<HTMLButtonElement>(".starter-back")!.click();
    expect(root.querySelectorAll(".faction-choice")).toHaveLength(
      STARTER_FACTIONS.length,
    );
  });
});
