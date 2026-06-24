/**
 * Pure filter/search logic for the card viewer — no DOM, so it's unit-tested
 * directly. Filter values are strings ("all" or a concrete value) to mirror
 * the <select> controls and stay trivially serializable.
 */
import type { Card } from "@euphoria/card-data/schema";

export interface CardFilters {
  /** Faction name, or "all". */
  faction: string;
  /** Card type, or "all". */
  type: string;
  /** Stringified Spirit cost, or "all". */
  cost: string;
  /** Free text matched against name and rules/effect text. */
  search: string;
}

export const DEFAULT_FILTERS: CardFilters = {
  faction: "all",
  type: "all",
  cost: "all",
  search: "",
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Distinct factions present, sorted — for building the faction control. */
export function uniqueFactions(cards: readonly Card[]): string[] {
  return uniqueSorted(cards.map((c) => c.faction));
}

/** Distinct card types present, sorted. */
export function uniqueTypes(cards: readonly Card[]): string[] {
  return uniqueSorted(cards.map((c) => c.type));
}

/** Distinct Spirit costs present, ascending. */
export function uniqueCosts(cards: readonly Card[]): number[] {
  return [...new Set(cards.map((c) => c.cost))].sort((a, b) => a - b);
}

function matchesSearch(card: Card, query: string): boolean {
  return (
    card.name.toLowerCase().includes(query) ||
    card.effectText.toLowerCase().includes(query)
  );
}

/** Returns the cards matching every active filter (a filter of "all"/"" is inactive). */
export function filterCards(
  cards: readonly Card[],
  filters: CardFilters,
): Card[] {
  const query = filters.search.trim().toLowerCase();
  return cards.filter(
    (card) =>
      (filters.faction === "all" || card.faction === filters.faction) &&
      (filters.type === "all" || card.type === filters.type) &&
      (filters.cost === "all" || card.cost === Number(filters.cost)) &&
      (query === "" || matchesSearch(card, query)),
  );
}
