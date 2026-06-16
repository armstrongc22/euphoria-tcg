/**
 * @vitest-environment jsdom
 *
 * Deck Builder rendering. Exercises the pure renderDeckBuilder builder: the
 * N/30 count badge, the validation banner, Add/Remove controls adjusting used
 * quantity and the count, Reset, and the Save callback (fired only when valid).
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { renderDeckBuilder } from "../src/deck-builder-view";
import { starterActiveDeck, deckSize } from "../src/deck-builder";
import type { DeckEntry } from "../src/starter";

const BASE = "/";

function build(
  initialDeck: readonly DeckEntry[],
  onSave = vi.fn(),
  onInspect?: (card: unknown) => void,
): HTMLElement {
  return renderDeckBuilder({
    faction: "Dwarf",
    pool: cards,
    owned: [],
    initialDeck,
    base: BASE,
    onSave,
    onInspect,
  });
}

describe("renderDeckBuilder", () => {
  it("shows a 30/30 count and an enabled Save for a valid starter deck", () => {
    const el = build(starterActiveDeck("Dwarf"));
    const badge = el.querySelector(".deck-builder__count")!;
    expect(badge.textContent).toBe("30/30");
    expect(badge.classList.contains("deck-builder__count--invalid")).toBe(false);
    const save = el.querySelector<HTMLButtonElement>(".deck-builder__save")!;
    expect(save.disabled).toBe(false);
  });

  it("marks an under-size deck invalid and disables Save", () => {
    const el = build(starterActiveDeck("Dwarf").slice(0, 5));
    const badge = el.querySelector(".deck-builder__count")!;
    expect(badge.classList.contains("deck-builder__count--invalid")).toBe(true);
    expect(el.querySelector<HTMLButtonElement>(".deck-builder__save")!.disabled).toBe(true);
    expect(el.querySelector(".deck-builder__banner--error")).not.toBeNull();
  });

  it("Remove then Add adjusts the count back to 30", () => {
    const el = build(starterActiveDeck("Dwarf"));
    const titanRow = el.querySelector<HTMLElement>('[data-slug="titan"]')!;
    const remove = titanRow.querySelector<HTMLButtonElement>(".deck-builder__btn--remove")!;
    remove.click();
    expect(el.querySelector(".deck-builder__count")!.textContent).toBe("29/30");

    // After re-render, re-query the row and add the copy back.
    const titanRow2 = el.querySelector<HTMLElement>('[data-slug="titan"]')!;
    titanRow2.querySelector<HTMLButtonElement>(".deck-builder__btn--add")!.click();
    expect(el.querySelector(".deck-builder__count")!.textContent).toBe("30/30");
  });

  it("disables Add when used reaches available (owned quantity)", () => {
    const el = build(starterActiveDeck("Dwarf"));
    // lahkt baseline 1, used 1 in the starter ⇒ Add is disabled.
    const lahktRow = el.querySelector<HTMLElement>(
      '[data-slug="lahkt-brand-family-products"]',
    )!;
    expect(
      lahktRow.querySelector<HTMLButtonElement>(".deck-builder__btn--add")!.disabled,
    ).toBe(true);
  });

  it("Reset restores the starter deck", () => {
    const partial = starterActiveDeck("Dwarf").slice(0, 5);
    const el = build(partial);
    expect(el.querySelector(".deck-builder__count")!.textContent).toBe(
      `${deckSize(partial)}/30`,
    );
    el.querySelector<HTMLButtonElement>(".deck-builder__reset")!.click();
    expect(el.querySelector(".deck-builder__count")!.textContent).toBe("30/30");
  });

  it("Save fires onSave with the current 30-card deck", () => {
    const onSave = vi.fn();
    const el = build(starterActiveDeck("Dwarf"), onSave);
    el.querySelector<HTMLButtonElement>(".deck-builder__save")!.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    const entries = onSave.mock.calls[0]![0] as DeckEntry[];
    expect(deckSize(entries)).toBe(30);
  });

  it("does not fire onSave while invalid", () => {
    const onSave = vi.fn();
    const el = build(starterActiveDeck("Dwarf").slice(0, 5), onSave);
    // Save is disabled, but guard the handler too.
    el.querySelector<HTMLButtonElement>(".deck-builder__save")!.click();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clicking a card's art/text fires onInspect with that card", () => {
    const onInspect = vi.fn();
    const el = build(starterActiveDeck("Dwarf"), vi.fn(), onInspect);
    const titanRow = el.querySelector<HTMLElement>('[data-slug="titan"]')!;
    titanRow.querySelector<HTMLButtonElement>(".deck-builder__inspect")!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect((onInspect.mock.calls[0]![0] as { slug: string }).slug).toBe("titan");
  });

  it("adjusting copies with +/− does not fire onInspect", () => {
    const onInspect = vi.fn();
    const el = build(starterActiveDeck("Dwarf"), vi.fn(), onInspect);
    const titanRow = el.querySelector<HTMLElement>('[data-slug="titan"]')!;
    titanRow.querySelector<HTMLButtonElement>(".deck-builder__btn--remove")!.click();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("omits the inspect trigger when no onInspect is provided", () => {
    const el = build(starterActiveDeck("Dwarf"));
    expect(el.querySelector(".deck-builder__inspect")).toBeNull();
    // Card art and name still render directly in the row.
    expect(el.querySelector(".deck-builder__art")).not.toBeNull();
  });
});
