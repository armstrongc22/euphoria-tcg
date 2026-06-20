/**
 * @vitest-environment jsdom
 *
 * Getting Started card: compact (default) shows only the current step; expanded
 * shows all 8; completion + hidden states. Visual redesign behavior.
 */
import { describe, expect, it, vi } from "vitest";
import { buildChecklist, type ChecklistState } from "../src/onboarding-checklist";
import {
  renderChecklistCard,
  renderShowGuide,
} from "../src/onboarding-checklist-view";

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
  onExpand: vi.fn(),
  onCollapse: vi.fn(),
  onHide: vi.fn(),
  onDismissComplete: vi.fn(),
});

describe("renderChecklistCard — compact (default)", () => {
  it("shows title, progress, the current step + CTA, and Show all steps", () => {
    const card = renderChecklistCard(buildChecklist(fresh), "compact", cbs());
    expect(card.classList.contains("onboarding--compact")).toBe(true);
    expect(card.querySelector(".onboarding__heading")?.textContent).toBe("Getting Started");
    expect(card.querySelector(".onboarding__count")?.textContent).toBe("0 of 8 complete");
    expect(card.querySelector(".onboarding__progress")).not.toBeNull();
    const current = card.querySelector<HTMLElement>(".onboarding__item--current");
    expect(current?.dataset.step).toBe("choose-starter");
    expect(current?.textContent).toContain("Choose Starter Deck");
    expect(card.querySelector(".onboarding__expand")?.textContent).toBe("Show all steps");
  });

  it("does NOT render upcoming/locked steps by default (only the current one)", () => {
    const card = renderChecklistCard(buildChecklist(fresh), "compact", cbs());
    expect(card.querySelectorAll(".onboarding__item")).toHaveLength(1);
    expect(card.querySelector(".onboarding__item--upcoming")).toBeNull();
  });

  it("Show all steps expands; Hide guide hides", () => {
    const cb = cbs();
    const card = renderChecklistCard(buildChecklist(fresh), "compact", cb);
    card.querySelector<HTMLButtonElement>(".onboarding__expand")!.click();
    expect(cb.onExpand).toHaveBeenCalledTimes(1);
    card.querySelector<HTMLButtonElement>(".onboarding__hide")!.click();
    expect(cb.onHide).toHaveBeenCalledTimes(1);
  });

  it("CTA fires with the current item", () => {
    const cb = cbs();
    const card = renderChecklistCard(buildChecklist(fresh), "compact", cb);
    card.querySelector<HTMLButtonElement>(".onboarding__cta")!.click();
    expect(cb.onCta.mock.calls[0]![0].id).toBe("choose-starter");
  });
});

describe("renderChecklistCard — expanded", () => {
  it("shows all 8 compact rows with their statuses and a Collapse control", () => {
    const c = buildChecklist({ ...fresh, hasFaction: true });
    const cb = cbs();
    const card = renderChecklistCard(c, "expanded", cb);
    expect(card.classList.contains("onboarding--expanded")).toBe(true);
    expect(card.querySelectorAll(".onboarding__item")).toHaveLength(8);
    // First step done, second current.
    expect(card.querySelector('[data-step="choose-starter"]')?.className).toContain(
      "onboarding__item--done",
    );
    expect(card.querySelector('[data-step="play-first-match"]')?.className).toContain(
      "onboarding__item--current",
    );
    expect(card.querySelector('[data-step="win-first-match"]')?.className).toContain(
      "onboarding__item--upcoming",
    );
    card.querySelector<HTMLButtonElement>(".onboarding__collapse")!.click();
    expect(cb.onCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("renderChecklistCard — completion + hidden", () => {
  it("renders the completion card with a Dismiss", () => {
    const complete = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 1,
      winCount: 5,
      ownedCount: 1,
      hasCustomDeck: true,
      customDeckMatchPlayed: true,
    });
    const cb = cbs();
    const card = renderChecklistCard(complete, "compact", cb);
    expect(card.classList.contains("onboarding--complete")).toBe(true);
    expect(card.textContent).toContain("You're set up");
    card.querySelector<HTMLButtonElement>(".onboarding__dismiss")!.click();
    expect(cb.onDismissComplete).toHaveBeenCalledTimes(1);
  });

  it("renderShowGuide brings the hidden guide back", () => {
    const onShow = vi.fn();
    const btn = renderShowGuide(onShow);
    expect(btn.textContent).toBe("Show Getting Started");
    btn.click();
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
