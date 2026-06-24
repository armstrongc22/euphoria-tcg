/**
 * Filter/search logic tests against the real card set. Assertions are by
 * predicate (every result matches) rather than hard-coded counts, so they
 * survive card-data tweaks.
 */
import { describe, expect, it } from "vitest";
import { cards } from "../src/cards";
import {
  DEFAULT_FILTERS,
  filterCards,
  uniqueCosts,
  uniqueFactions,
  uniqueTypes,
  type CardFilters,
} from "../src/filters";

const f = (over: Partial<CardFilters>): CardFilters => ({
  ...DEFAULT_FILTERS,
  ...over,
});

describe("option derivation", () => {
  it("lists distinct factions sorted", () => {
    const factions = uniqueFactions(cards);
    expect(factions).toEqual([...factions].sort());
    expect(new Set(factions).size).toBe(factions.length);
    expect(factions).toContain("Monk");
    expect(factions).toContain("Neutral");
  });

  it("lists distinct types and ascending costs", () => {
    expect(uniqueTypes(cards)).toContain("Warrior");
    const costs = uniqueCosts(cards);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(costs.every((c) => typeof c === "number")).toBe(true);
  });
});

describe("filterCards", () => {
  it("returns everything with the default filters", () => {
    expect(filterCards(cards, DEFAULT_FILTERS)).toHaveLength(cards.length);
  });

  it("filters by faction", () => {
    const result = filterCards(cards, f({ faction: "Monk" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.faction === "Monk")).toBe(true);
  });

  it("filters by type", () => {
    const result = filterCards(cards, f({ type: "Item" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.type === "Item")).toBe(true);
  });

  it("filters by cost", () => {
    const result = filterCards(cards, f({ cost: "1" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.cost === 1)).toBe(true);
  });

  it("searches by card name (case-insensitive)", () => {
    const result = filterCards(cards, f({ search: "HIDEON" }));
    expect(result.some((c) => c.slug === "hideon")).toBe(true);
    expect(result.every((c) => c.name.toLowerCase().includes("hideon"))).toBe(true);
  });

  it("searches by rules/effect text", () => {
    // GILs Unit's rules text mentions putting a Warrior "out of play".
    const result = filterCards(cards, f({ search: "out of play" }));
    expect(result.some((c) => c.slug === "gils-unit")).toBe(true);
    expect(
      result.every(
        (c) =>
          c.name.toLowerCase().includes("out of play") ||
          c.effectText.toLowerCase().includes("out of play"),
      ),
    ).toBe(true);
  });

  it("combines filters (AND semantics)", () => {
    const result = filterCards(cards, f({ faction: "Monk", type: "Warrior" }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.faction === "Monk" && c.type === "Warrior")).toBe(
      true,
    );
    // Strictly fewer than the faction-only set (Monk also has Attack cards).
    expect(result.length).toBeLessThan(
      filterCards(cards, f({ faction: "Monk" })).length,
    );
  });

  it("returns nothing when nothing matches", () => {
    expect(filterCards(cards, f({ search: "zzz-no-such-card" }))).toEqual([]);
  });

  it("treats blank/whitespace search as inactive", () => {
    expect(filterCards(cards, f({ search: "   " }))).toHaveLength(cards.length);
  });
});
