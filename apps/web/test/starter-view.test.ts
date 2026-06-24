/**
 * @vitest-environment jsdom
 *
 * Starter Decks render tests. Proves the UI logic can build a deck panel for
 * every faction: one row per recipe line, with quantity, name, type, and an
 * image for each card, plus the featured spotlight and the upgrades teaser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cards } from "@euphoria/core/cards";
import { mountStarterDecks, renderDeckPanel } from "../src/starter-view";
import { STARTER_FACTIONS, getRecipe } from "@euphoria/core/starter";

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

describe("mountStarterDecks — onboarding (Features A/B)", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows the welcome panel + steps for a brand-new player (no faction)", () => {
    const container = document.createElement("div");
    mountStarterDecks(container, cards, { onViewRules: () => {} });
    const welcome = container.querySelector(".starter-welcome");
    expect(welcome).not.toBeNull();
    expect(welcome!.textContent).toContain("Welcome to Euphoria TCG");
    expect(welcome!.querySelectorAll(".starter-welcome__steps li")).toHaveLength(5);
    expect(welcome!.querySelector(".starter-welcome__rules")).not.toBeNull();
    // The switch-resets helper text is shown under the choices.
    expect(container.querySelector(".starter-helper")?.textContent).toContain(
      "resets beta progression",
    );
  });

  it("does not show the welcome panel for a returning player (has faction)", () => {
    const container = document.createElement("div");
    mountStarterDecks(container, cards, { currentFaction: "Sonic", initialFaction: null });
    expect(container.querySelector(".starter-welcome")).toBeNull();
  });

  it("Skip tutorial hides the welcome panel and persists the dismissal", () => {
    const container = document.createElement("div");
    mountStarterDecks(container, cards, {});
    container.querySelector<HTMLButtonElement>(".starter-welcome__skip")!.click();
    expect(container.querySelector(".starter-welcome")).toBeNull();
    // Re-mounting keeps it hidden.
    const again = document.createElement("div");
    mountStarterDecks(again, cards, {});
    expect(again.querySelector(".starter-welcome")).toBeNull();
  });

  it("selecting a first starter deck shows the play-live-match next step", () => {
    const container = document.createElement("div");
    const onPlayMatch = vi.fn();
    mountStarterDecks(container, cards, { onPlayMatch });
    container
      .querySelector<HTMLButtonElement>('.faction-choice__cta[data-faction="Sonic"]')!
      .click();
    const prompt = container.querySelector(".starter-nextstep");
    expect(prompt).not.toBeNull();
    expect(prompt!.textContent).toContain("play your first live match");
    container.querySelector<HTMLButtonElement>(".starter-nextstep__play")!.click();
    expect(onPlayMatch).toHaveBeenCalledWith("Sonic");
  });
});
