/**
 * Beta signup logic tests. Email validation and the localStorage-shaped state
 * machine, exercised with an in-memory store so they run in the default node
 * environment (no DOM needed).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIGNUP_STORAGE_KEY,
  clearSignup,
  isValidEmail,
  loadSignup,
  recordFaction,
  recordSignup,
  type KeyValueStore,
} from "../src/signup";

/** Minimal in-memory KeyValueStore for tests. */
function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of [
      "a@b.co",
      "player@example.com",
      "First.Last+tag@sub.domain.io",
    ]) {
      expect(isValidEmail(email)).toBe(true);
    }
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidEmail("  player@example.com  ")).toBe(true);
  });

  it("rejects malformed or empty values", () => {
    for (const email of [
      "",
      "   ",
      "no-at-sign",
      "missing@domain",
      "@example.com",
      "spaces in@example.com",
      "two@@example.com",
      "trailing@example.com x",
    ]) {
      expect(isValidEmail(email)).toBe(false);
    }
  });

  it("rejects absurdly long input", () => {
    expect(isValidEmail(`${"x".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("signup state", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("returns null when nothing is stored", () => {
    expect(loadSignup(store)).toBeNull();
  });

  it("records and reloads an email (normalized to lower-case)", () => {
    recordSignup(store, "  Player@Example.com ", new Date("2026-06-15T00:00:00Z"));
    const state = loadSignup(store);
    expect(state).toEqual({
      email: "player@example.com",
      faction: null,
      signedUpAt: "2026-06-15T00:00:00.000Z",
    });
  });

  it("refuses to store an invalid email", () => {
    expect(() => recordSignup(store, "nope")).toThrow();
    expect(store.map.has(SIGNUP_STORAGE_KEY)).toBe(false);
  });

  it("records a faction choice, even before any email", () => {
    recordFaction(store, "Sonic");
    expect(loadSignup(store)?.faction).toBe("Sonic");
    expect(loadSignup(store)?.email).toBe("");
  });

  it("preserves a chosen faction across a later email signup", () => {
    recordFaction(store, "Surfer");
    recordSignup(store, "player@example.com");
    const state = loadSignup(store)!;
    expect(state.email).toBe("player@example.com");
    expect(state.faction).toBe("Surfer");
  });

  it("preserves the email when the faction changes", () => {
    recordSignup(store, "player@example.com");
    recordFaction(store, "Dwarf");
    recordFaction(store, "Monk");
    const state = loadSignup(store)!;
    expect(state.email).toBe("player@example.com");
    expect(state.faction).toBe("Monk");
  });

  it("ignores an unknown faction in stored data", () => {
    store.setItem(
      SIGNUP_STORAGE_KEY,
      JSON.stringify({ email: "p@e.co", faction: "Shaman", signedUpAt: "x" }),
    );
    expect(loadSignup(store)?.faction).toBeNull();
  });

  it("returns null for corrupt JSON instead of throwing", () => {
    store.setItem(SIGNUP_STORAGE_KEY, "{not json");
    expect(loadSignup(store)).toBeNull();
  });

  it("clears stored state", () => {
    recordSignup(store, "player@example.com");
    clearSignup(store);
    expect(loadSignup(store)).toBeNull();
  });
});
