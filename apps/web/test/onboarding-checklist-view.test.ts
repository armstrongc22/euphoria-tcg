/**
 * @vitest-environment jsdom
 *
 * Getting Started checklist card: prominent full shape, the current step's CTA,
 * the collapsed shape (after Skip), and the completion shape.
 */
import { describe, expect, it, vi } from "vitest";
import { buildChecklist, type ChecklistState } from "../src/onboarding-checklist";
import { renderChecklistCard } from "../src/onboarding-checklist-view";

const fresh: ChecklistState = {
  hasFaction: false,
  matchCount: 0,
  winCount: 0,
  ownedCount: 0,
  pendingCount: 0,
  hasCustomDeck: false,
  deckBuilderOpened: false,
  customDeckMatchPlayed: false,
};

const cbs = () => ({
  onCta: vi.fn(),
  onCollapse: vi.fn(),
  onExpand: vi.fn(),
  onDismissComplete: vi.fn(),
});

describe("renderChecklistCard", () => {
  it("renders a prominent heading, progress bar, and all 8 rows (full)", () => {
    const card = renderChecklistCard(buildChecklist(fresh), false, cbs());
    expect(card.querySelector(".onboarding__heading")?.textContent).toBe("Getting Started");
    expect(card.querySelector(".onboarding__progress")).not.toBeNull();
    expect(card.querySelectorAll(".onboarding__item")).toHaveLength(8);
    // The first step is current with its CTA inline.
    const current = card.querySelector<HTMLElement>(".onboarding__item--current");
    expect(current?.dataset.step).toBe("choose-starter");
    expect(current?.textContent).toContain("Choose Starter Deck");
  });

  it("fires onCta with the current item when its CTA is clicked", () => {
    const cb = cbs();
    const card = renderChecklistCard(buildChecklist(fresh), false, cb);
    card.querySelector<HTMLButtonElement>(".onboarding__cta")!.click();
    expect(cb.onCta).toHaveBeenCalledTimes(1);
    expect(cb.onCta.mock.calls[0]![0].id).toBe("choose-starter");
  });

  it("Skip for now collapses (and Show all steps expands)", () => {
    const cb = cbs();
    const full = renderChecklistCard(buildChecklist(fresh), false, cb);
    full.querySelector<HTMLButtonElement>(".onboarding__collapse")!.click();
    expect(cb.onCollapse).toHaveBeenCalledTimes(1);

    // Collapsed shape: compact, no full row list, but keeps the current CTA.
    const collapsed = renderChecklistCard(buildChecklist(fresh), true, cb);
    expect(collapsed.classList.contains("onboarding--collapsed")).toBe(true);
    expect(collapsed.querySelectorAll(".onboarding__item")).toHaveLength(0);
    expect(collapsed.querySelector(".onboarding__cta")).not.toBeNull();
    collapsed.querySelector<HTMLButtonElement>(".onboarding__expand")!.click();
    expect(cb.onExpand).toHaveBeenCalledTimes(1);
  });

  it("renders the completion card with a dismiss action", () => {
    const complete = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 1,
      winCount: 5,
      ownedCount: 1,
      hasCustomDeck: true,
      customDeckMatchPlayed: true,
    });
    expect(complete.complete).toBe(true);
    const cb = cbs();
    const card = renderChecklistCard(complete, false, cb);
    expect(card.classList.contains("onboarding--complete")).toBe(true);
    expect(card.textContent).toContain("You're set up");
    card.querySelector<HTMLButtonElement>(".onboarding__dismiss")!.click();
    expect(cb.onDismissComplete).toHaveBeenCalledTimes(1);
  });
});
