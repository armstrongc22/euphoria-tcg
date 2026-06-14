/**
 * Deterministic card ordering so the grid is scannable: grouped by faction,
 * then type, then ascending cost, then name. Pure — unit-tested.
 */
import type { Card } from "@euphoria/card-data/schema";

const FACTION_ORDER = ["Monk", "Surfer", "Dwarf", "Sonic", "Shaman", "Neutral"];
const TYPE_ORDER = ["Warrior", "Weapon", "Item", "Attack"];

/** Index in `order`, or `order.length` for unknown values (sorts last). */
function rank(order: readonly string[], value: string): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

export function compareCards(a: Card, b: Card): number {
  return (
    rank(FACTION_ORDER, a.faction) - rank(FACTION_ORDER, b.faction) ||
    rank(TYPE_ORDER, a.type) - rank(TYPE_ORDER, b.type) ||
    a.cost - b.cost ||
    a.name.localeCompare(b.name)
  );
}

/** A new array of the cards in display order; the input is not mutated. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
