/**
 * Onboarding v2 checklist: state-derived step statuses, the current actionable
 * step, completion, and the local progress/dismissal flags. Node — no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PROGRESS_KEY,
  buildChecklist,
  hasOnboardingProgress,
  isOnboardingDismissed,
  markOnboardingProgress,
  setOnboardingDismissed,
  type ChecklistState,
} from "../src/onboarding-checklist";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

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

function current(state: ChecklistState): string | undefined {
  return buildChecklist(state).currentId;
}

describe("buildChecklist — state-derived steps", () => {
  it("always has the 8 journey steps", () => {
    expect(buildChecklist(fresh).items.map((i) => i.id)).toEqual([
      "choose-starter",
      "play-first-match",
      "win-first-match",
      "first-milestone",
      "claim-reward",
      "open-deck-builder",
      "save-custom-deck",
      "play-custom-deck",
    ]);
  });

  it("brand-new player: current step is Choose starter deck", () => {
    expect(current(fresh)).toBe("choose-starter");
    const card = buildChecklist(fresh);
    const choose = card.items[0]!;
    expect(choose.status).toBe("current");
    expect(choose.cta).toBe("Choose Starter Deck");
    expect(card.doneCount).toBe(0);
  });

  it("faction, no matches → Play first match", () => {
    const c = buildChecklist({ ...fresh, hasFaction: true });
    expect(c.currentId).toBe("play-first-match");
    expect(c.items[0]!.status).toBe("done");
    expect(c.items.find((i) => i.id === "play-first-match")!.cta).toBe("Play Match");
  });

  it("played a match (no win) → Win first match", () => {
    expect(current({ ...fresh, hasFaction: true, matchCount: 1 })).toBe("win-first-match");
  });

  it("won but below milestone → Reach first reward milestone", () => {
    expect(
      current({ ...fresh, hasFaction: true, matchCount: 3, winCount: 2 }),
    ).toBe("first-milestone");
  });

  it("pending reward → claim step shows retry guidance + CTA", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 6,
      winCount: 5,
      pendingCount: 1,
    });
    const claim = c.items.find((i) => i.id === "claim-reward")!;
    expect(c.currentId).toBe("claim-reward");
    expect(claim.status).toBe("current");
    expect(claim.body.toLowerCase()).toContain("pending sync");
    expect(claim.cta).toBe("Retry Reward Sync");
  });

  it("owned reward, no custom deck → Open Deck Builder", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 6,
      winCount: 5,
      ownedCount: 1,
    });
    expect(c.currentId).toBe("open-deck-builder");
    expect(c.items.find((i) => i.id === "open-deck-builder")!.cta).toBe("Open Deck Builder");
  });

  it("opened deck builder but no custom deck → Save custom deck", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 6,
      winCount: 5,
      ownedCount: 1,
      deckBuilderOpened: true,
    });
    expect(c.currentId).toBe("save-custom-deck");
  });

  it("custom deck saved (not yet tested) → Play with custom deck", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 6,
      winCount: 5,
      ownedCount: 1,
      hasCustomDeck: true,
    });
    expect(c.currentId).toBe("play-custom-deck");
    expect(c.items.find((i) => i.id === "play-custom-deck")!.cta).toBe("Play Match");
  });
});

describe("buildChecklist — completion (Feature G)", () => {
  it("is complete with faction + a match + a reward + a custom deck", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 4,
      winCount: 5,
      ownedCount: 1,
      hasCustomDeck: true,
      customDeckMatchPlayed: true,
    });
    expect(c.complete).toBe(true);
    expect(c.currentId).toBeUndefined();
    expect(c.completionMessage).toContain("You're set up");
  });

  it("is NOT complete while a reward is only pending (not owned)", () => {
    const c = buildChecklist({
      ...fresh,
      hasFaction: true,
      matchCount: 4,
      pendingCount: 1,
      hasCustomDeck: true,
    });
    expect(c.complete).toBe(false);
  });
});

describe("onboarding local flags", () => {
  it("progress markers persist and are independent of dismissal", () => {
    const store = memoryStore();
    expect(hasOnboardingProgress(store, "deckBuilderOpened")).toBe(false);
    markOnboardingProgress(store, "deckBuilderOpened");
    expect(hasOnboardingProgress(store, "deckBuilderOpened")).toBe(true);
    // Dismissal is a separate key — collapsing doesn't erase progress.
    setOnboardingDismissed(store, true);
    expect(isOnboardingDismissed(store)).toBe(true);
    expect(hasOnboardingProgress(store, "deckBuilderOpened")).toBe(true);
    expect(store.map.has(ONBOARDING_PROGRESS_KEY)).toBe(true);
  });

  it("dismissal toggles cleanly and degrades with a null store", () => {
    const store = memoryStore();
    setOnboardingDismissed(store, true);
    setOnboardingDismissed(store, false);
    expect(isOnboardingDismissed(store)).toBe(false);
    expect(isOnboardingDismissed(null)).toBe(false);
    expect(() => markOnboardingProgress(null, "customDeckMatchPlayed")).not.toThrow();
  });
});
