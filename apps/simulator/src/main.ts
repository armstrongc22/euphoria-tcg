/**
 * Local simulator entry point. For now it just proves the card database
 * loads; the game loop arrives with the rules engine.
 */
import { loadCards } from "@euphoria/card-data";

const cards = loadCards();

const countBy = (key: "type" | "faction") => {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card[key], (counts.get(card[key]) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
};

console.log(`Euphoria simulator — loaded ${cards.length} cards`);
console.log("By type:", countBy("type"));
console.log("By faction:", countBy("faction"));
