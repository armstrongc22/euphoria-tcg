/**
 * PvP recovery pointer: save/load/clear against an in-memory store, user
 * scoping, and corruption tolerance. Mirrors match-recovery's contract.
 */
import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@euphoria/core/signup";
import {
  PVP_POINTER_KEY,
  PVP_POINTER_VERSION,
  coercePvpPointer,
  clearPvpPointer,
  loadPvpPointer,
  savePvpPointer,
} from "@euphoria/core/pvp-recovery";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const input = { userId: "user-1", matchId: "match-9", roomId: "room-4" };

describe("pvp-recovery pointer", () => {
  it("round-trips a saved pointer for the same user", () => {
    const store = memoryStore();
    expect(savePvpPointer(store, input, new Date("2026-07-08T12:00:00Z"))).toBe(true);
    const loaded = loadPvpPointer(store, "user-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.matchId).toBe("match-9");
    expect(loaded!.roomId).toBe("room-4");
    expect(loaded!.version).toBe(PVP_POINTER_VERSION);
    expect(loaded!.savedAt).toBe("2026-07-08T12:00:00.000Z");
  });

  it("never returns another user's pointer", () => {
    const store = memoryStore();
    savePvpPointer(store, input);
    expect(loadPvpPointer(store, "user-2")).toBeNull();
  });

  it("returns null on absent, corrupt, or wrong-version data", () => {
    const store = memoryStore();
    expect(loadPvpPointer(store, "user-1")).toBeNull();
    store.map.set(PVP_POINTER_KEY, "{not json");
    expect(loadPvpPointer(store, "user-1")).toBeNull();
    store.map.set(
      PVP_POINTER_KEY,
      JSON.stringify({ ...input, version: PVP_POINTER_VERSION + 1, savedAt: "x" }),
    );
    expect(loadPvpPointer(store, "user-1")).toBeNull();
  });

  it("clearPvpPointer removes the record", () => {
    const store = memoryStore();
    savePvpPointer(store, input);
    clearPvpPointer(store);
    expect(loadPvpPointer(store, "user-1")).toBeNull();
  });

  it("save is best-effort: a throwing store returns false, never throws", () => {
    const store: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(savePvpPointer(store, input)).toBe(false);
    expect(() => clearPvpPointer(store)).not.toThrow();
    expect(loadPvpPointer(store, "user-1")).toBeNull();
  });

  it("coercePvpPointer rejects envelope violations", () => {
    expect(coercePvpPointer(null)).toBeNull();
    expect(coercePvpPointer("str")).toBeNull();
    expect(
      coercePvpPointer({
        version: PVP_POINTER_VERSION,
        userId: "",
        matchId: "m",
        roomId: "r",
        savedAt: "t",
      }),
    ).toBeNull();
    expect(
      coercePvpPointer({
        version: PVP_POINTER_VERSION,
        userId: "u",
        matchId: "m",
        roomId: "r",
        savedAt: "t",
      }),
    ).not.toBeNull();
  });
});
