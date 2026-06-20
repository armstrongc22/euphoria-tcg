/**
 * Tutorial dismissal flags + the pure nextStep guidance. Node — no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  TUTORIAL_STORAGE_KEY,
  dismissTutorial,
  isTutorialDismissed,
  nextStep,
  resetTutorial,
  type NextStepState,
} from "../src/tutorial";
import type { KeyValueStore } from "../src/signup";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const base: NextStepState = {
  hasFaction: true,
  matchCount: 0,
  ownedCount: 0,
  pendingCount: 0,
  hasCustomDeck: false,
};

describe("tutorial dismissal flags", () => {
  it("defaults to not dismissed and round-trips a dismissal", () => {
    const store = memoryStore();
    expect(isTutorialDismissed(store, "welcome")).toBe(false);
    dismissTutorial(store, "welcome");
    expect(isTutorialDismissed(store, "welcome")).toBe(true);
    // Other flags are unaffected.
    expect(isTutorialDismissed(store, "liveHints")).toBe(false);
  });

  it("resetTutorial clears ALL flags and nothing else", () => {
    const store = memoryStore();
    dismissTutorial(store, "welcome");
    dismissTutorial(store, "deckBuilder");
    // A non-tutorial key must survive a reset.
    store.setItem("euphoria.owned.v1", "[]");
    resetTutorial(store);
    expect(isTutorialDismissed(store, "welcome")).toBe(false);
    expect(isTutorialDismissed(store, "deckBuilder")).toBe(false);
    expect(store.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
    expect(store.getItem("euphoria.owned.v1")).toBe("[]");
  });

  it("degrades safely with a null store", () => {
    expect(isTutorialDismissed(null, "welcome")).toBe(false);
    expect(() => dismissTutorial(null, "welcome")).not.toThrow();
    expect(() => resetTutorial(null)).not.toThrow();
  });
});

describe("nextStep guidance (Feature C)", () => {
  it("no faction → choose a starter deck", () => {
    expect(nextStep({ ...base, hasFaction: false }).id).toBe("choose-faction");
  });

  it("faction, no matches → play your first live match", () => {
    expect(nextStep({ ...base, matchCount: 0 }).id).toBe("first-match");
  });

  it("matches but no rewards → win matches for the next milestone", () => {
    expect(nextStep({ ...base, matchCount: 3 }).id).toBe("win-rewards");
  });

  it("pending reward takes priority", () => {
    expect(
      nextStep({ ...base, matchCount: 6, ownedCount: 1, pendingCount: 1 }).id,
    ).toBe("pending-reward");
  });

  it("owned cards, no custom deck → use Deck Builder", () => {
    expect(nextStep({ ...base, matchCount: 6, ownedCount: 2 }).id).toBe("build-deck");
  });

  it("custom deck active → test it in a live match", () => {
    expect(
      nextStep({ ...base, matchCount: 6, ownedCount: 2, hasCustomDeck: true }).id,
    ).toBe("custom-active");
  });

  it("always returns a non-empty body", () => {
    for (const s of [
      { ...base, hasFaction: false },
      base,
      { ...base, matchCount: 3 },
      { ...base, pendingCount: 1 },
      { ...base, ownedCount: 1 },
      { ...base, hasCustomDeck: true },
    ]) {
      expect(nextStep(s).body.length).toBeGreaterThan(0);
    }
  });
});
