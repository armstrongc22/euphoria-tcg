/**
 * Crash/refresh recovery persistence: save/load/clear of an in-progress live
 * match, version + user scoping, and corruption safety. Pure/node — no DOM.
 */
import { describe, expect, it } from "vitest";
import type { GameAction } from "@euphoria/game-engine";
import {
  ACTIVE_MATCH_KEY,
  SAVE_VERSION,
  clearActiveMatch,
  coerceSavedMatch,
  loadActiveMatch,
  saveActiveMatch,
  snapshotInfo,
  type SavedMatchInput,
} from "../src/match-recovery";
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

const ACTIONS = [{ kind: "endTurn" }] as unknown as GameAction[];

function input(overrides: Partial<SavedMatchInput> = {}): SavedMatchInput {
  return {
    userId: "user-1",
    faction: "Sonic",
    opponentFaction: "Dwarf",
    seed: 42,
    playerDeck: null,
    actions: ACTIONS,
    turn: 7,
    ...overrides,
  };
}

describe("saveActiveMatch / loadActiveMatch", () => {
  it("round-trips a saved match for the same user", () => {
    const store = memoryStore();
    saveActiveMatch(store, input(), new Date("2026-06-20T00:00:00Z"));
    const loaded = loadActiveMatch(store, "user-1");
    expect(loaded).not.toBeNull();
    expect(loaded).toMatchObject({
      version: SAVE_VERSION,
      userId: "user-1",
      faction: "Sonic",
      opponentFaction: "Dwarf",
      seed: 42,
      turn: 7,
      savedAt: "2026-06-20T00:00:00.000Z",
    });
    expect(loaded!.actions).toHaveLength(1);
  });

  it("does not return another user's saved match", () => {
    const store = memoryStore();
    saveActiveMatch(store, input({ userId: "user-1" }));
    expect(loadActiveMatch(store, "user-2")).toBeNull();
  });

  it("preserves a custom playerDeck", () => {
    const store = memoryStore();
    saveActiveMatch(store, input({ playerDeck: [{ slug: "kit", quantity: 3 }] }));
    expect(loadActiveMatch(store, "user-1")!.playerDeck).toEqual([
      { slug: "kit", quantity: 3 },
    ]);
  });

  it("returns null on corrupt JSON rather than throwing", () => {
    const store = memoryStore();
    store.setItem(ACTIVE_MATCH_KEY, "{not json");
    expect(loadActiveMatch(store, "user-1")).toBeNull();
  });

  it("invalidates a save from an older version", () => {
    const store = memoryStore();
    store.setItem(
      ACTIVE_MATCH_KEY,
      JSON.stringify({ ...input(), version: SAVE_VERSION + 1, savedAt: "x" }),
    );
    expect(loadActiveMatch(store, "user-1")).toBeNull();
  });

  it("clearActiveMatch removes the save", () => {
    const store = memoryStore();
    saveActiveMatch(store, input());
    clearActiveMatch(store);
    expect(loadActiveMatch(store, "user-1")).toBeNull();
  });
});

describe("coerceSavedMatch", () => {
  it("rejects non-objects and bad factions", () => {
    expect(coerceSavedMatch(null)).toBeNull();
    expect(coerceSavedMatch(42)).toBeNull();
    expect(
      coerceSavedMatch({ ...input(), version: SAVE_VERSION, savedAt: "x", faction: "Goblin" }),
    ).toBeNull();
  });

  it("accepts a well-formed current-version record", () => {
    const ok = coerceSavedMatch({ ...input(), version: SAVE_VERSION, savedAt: "x" });
    expect(ok).not.toBeNull();
    expect(ok!.faction).toBe("Sonic");
  });
});

describe("saveActiveMatch — write-failure signalling", () => {
  it("returns false when the store throws (quota/blocked)", () => {
    const failing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(saveActiveMatch(failing, input())).toBe(false);
  });

  it("returns true on a successful write", () => {
    expect(saveActiveMatch(memoryStore(), input())).toBe(true);
  });
});

describe("snapshotInfo", () => {
  it("reports no snapshot when none is stored", () => {
    expect(snapshotInfo(memoryStore(), "user-1")).toMatchObject({
      exists: false,
      bytes: 0,
      problem: null,
    });
  });

  it("reports size, turn, and age for a stored snapshot", () => {
    const store = memoryStore();
    saveActiveMatch(store, input({ turn: 12 }), new Date("2026-06-20T00:00:00Z"));
    const info = snapshotInfo(store, "user-1", new Date("2026-06-20T00:00:30Z"));
    expect(info.exists).toBe(true);
    expect(info.turn).toBe(12);
    expect(info.bytes).toBeGreaterThan(0);
    expect(info.ageSeconds).toBe(30);
    expect(info.problem).toBeNull();
  });

  it("flags a corrupt snapshot with a problem reason", () => {
    const store = memoryStore();
    store.setItem(ACTIVE_MATCH_KEY, "{not json");
    expect(snapshotInfo(store, "user-1")).toMatchObject({
      exists: true,
      problem: "corrupt JSON",
    });
  });

  it("flags a different user's snapshot", () => {
    const store = memoryStore();
    saveActiveMatch(store, input({ userId: "someone-else" }));
    expect(snapshotInfo(store, "user-1").problem).toBe("different user");
  });
});
