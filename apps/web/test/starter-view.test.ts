/**
 * @vitest-environment jsdom
 *
 * Starter Decks render tests. Proves the UI logic can build a deck panel for
 * every faction: one row per recipe line, with quantity, name, type, and an
 * image for each card, plus the featured spotlight and the upgrades teaser.
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { mountStarterDecks, renderDeckPanel } from "../src/starter-view";
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

describe("mountStarterDecks — starter switch confirmation (Part B)", () => {
  function mount(currentFaction: "Sonic" | null) {
    const container = document.createElement("div");
    const onChoose = vi.fn();
    mountStarterDecks(container, cards, {
      initialFaction: currentFaction,
      currentFaction,
      onChoose,
    });
    return { container, onChoose };
  }

  /** Clicks the "Choose this deck" button for `faction` from the choices grid. */
  function chooseFaction(container: HTMLElement, faction: string): void {
    const btn = container.querySelector<HTMLButtonElement>(
      `.faction-choice__cta[data-faction="${faction}"]`,
    );
    if (btn === null) throw new Error(`choose button for ${faction} not found`);
    btn.click();
  }

  it("first-time pick commits immediately with no reset and no dialog", () => {
    const { container, onChoose } = mount(null);
    chooseFaction(container, "Sonic");
    expect(container.querySelector(".starter-confirm")).toBeNull();
    expect(onChoose).toHaveBeenCalledWith("Sonic", { resetProgression: false });
  });

  it("switching to a different faction shows a confirmation dialog", () => {
    const { container, onChoose } = mount("Sonic");
    // Returning player opens on their deck; go back to the choices first.
    container.querySelector<HTMLButtonElement>(".starter-back")!.click();
    chooseFaction(container, "Dwarf");
    const dialog = container.querySelector(".starter-confirm");
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Switch starter deck?");
    expect(dialog!.textContent).toContain("Sonic");
    expect(dialog!.textContent).toContain("Dwarf");
    expect(dialog!.textContent?.toLowerCase()).toContain("reset your beta progression");
    // Not committed yet.
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("Cancel keeps the faction and changes nothing", () => {
    const { container, onChoose } = mount("Sonic");
    container.querySelector<HTMLButtonElement>(".starter-back")!.click();
    chooseFaction(container, "Dwarf");
    container.querySelector<HTMLButtonElement>(".starter-confirm__cancel")!.click();
    expect(container.querySelector(".starter-confirm")).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("Confirm commits the switch with resetProgression: true", () => {
    const { container, onChoose } = mount("Sonic");
    container.querySelector<HTMLButtonElement>(".starter-back")!.click();
    chooseFaction(container, "Dwarf");
    container.querySelector<HTMLButtonElement>(".starter-confirm__confirm")!.click();
    expect(container.querySelector(".starter-confirm")).toBeNull();
    expect(onChoose).toHaveBeenCalledWith("Dwarf", { resetProgression: true });
  });
});
