/**
 * CLI for the replay/event-trace tool. Runs one deterministic game and prints
 * a readable turn-by-turn trace. Instrumentation only — no card or deck changes.
 *
 *   npm run sim:trace -- --p1 Monk --p2 Dwarf --seed 123 --max-turns 20
 */
import { loadCards } from "@euphoria/card-data";
import { DECK_FACTIONS, type DeckFaction } from "./deck";
import { formatTrace, generateTrace } from "./trace";

function numberFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} expects a number, got "${process.argv[i + 1]}"`);
  }
  return value;
}

function factionFlag(name: string, fallback: DeckFaction): DeckFaction {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const raw = process.argv[i + 1];
  const match = DECK_FACTIONS.find((f) => f.toLowerCase() === raw?.toLowerCase());
  if (match === undefined) {
    throw new Error(
      `--${name} expects one of: ${DECK_FACTIONS.join(", ")} (got "${raw}")`,
    );
  }
  return match;
}

const trace = generateTrace({
  pool: loadCards(),
  player1Faction: factionFlag("p1", "Monk"),
  player2Faction: factionFlag("p2", "Dwarf"),
  seed: numberFlag("seed", 1),
  maxTurns: numberFlag("max-turns", 50),
});

console.log(formatTrace(trace));
