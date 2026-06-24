/**
 * Card ordering tests: deterministic grouping by faction, then type, cost, name.
 */
import { describe, expect, it } from "vitest";
import { cards } from "../src/cards";
import { compareCards, sortCards } from "../src/sort";

describe("sortCards", () => {
  it("does not mutate the input", () => {
    const before = cards.slice();
    sortCards(cards);
    expect(cards).toEqual(before);
  });

  it("groups by faction in the defined order", () => {
    const order = ["Monk", "Surfer", "Dwarf", "Sonic", "Shaman", "Neutral"];
    const factions: string[] = sortCards(cards).map((c) => c.faction);
    // Each faction's cards are contiguous and appear in the defined sequence.
    const firstIndex = order
      .map((f) => factions.indexOf(f))
      .filter((i) => i !== -1);
    expect(firstIndex).toEqual([...firstIndex].sort((a, b) => a - b));
    for (const faction of order) {
      const idxs = factions
        .map((f, i) => (f === faction ? i : -1))
        .filter((i) => i !== -1);
      if (idxs.length > 0) {
        expect(idxs[idxs.length - 1]! - idxs[0]!).toBe(idxs.length - 1); // contiguous
      }
    }
  });

  it("breaks ties within a faction by cost then name", () => {
    const monkWarriors = sortCards(cards).filter(
      (c) => c.faction === "Monk" && c.type === "Warrior",
    );
    for (let i = 1; i < monkWarriors.length; i++) {
      const prev = monkWarriors[i - 1]!;
      const cur = monkWarriors[i]!;
      const ordered =
        prev.cost < cur.cost ||
        (prev.cost === cur.cost && prev.name.localeCompare(cur.name) <= 0);
      expect(ordered).toBe(true);
    }
  });

  it("compareCards is a consistent comparator (sign-symmetric)", () => {
    const [a, b] = [cards[0]!, cards[1]!];
    expect(Math.sign(compareCards(a, b))).toBe(-Math.sign(compareCards(b, a)));
  });
});
