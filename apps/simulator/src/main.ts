/**
 * Local simulator CLI. Plays a batch of greedy-vs-greedy games between faction
 * decks (Monk / Surfer / Dwarf / Sonic — no Shaman) through the engine, then
 * prints per-game outcomes plus aggregate and per-faction summaries. All the
 * work lives in deck.ts / agents.ts / runner.ts; this file is wiring + output.
 *
 *   npm start --workspace @euphoria/simulator -- [games] [seed] [factionA] [factionB]
 */
import { loadCards } from "@euphoria/card-data";
import { createRng, type PlayerId } from "@euphoria/game-engine";
import { greedyAgent } from "./agents";
import { buildFactionDeck, DECK_FACTIONS, type DeckFaction } from "./deck";
import { runGame, type GameResult } from "./runner";

function parseFaction(arg: string | undefined): DeckFaction | undefined {
  const match = DECK_FACTIONS.find((f) => f.toLowerCase() === arg?.toLowerCase());
  if (arg !== undefined && match === undefined) {
    throw new Error(`Unknown faction "${arg}". Choose from: ${DECK_FACTIONS.join(", ")}`);
  }
  return match;
}

const games = Number(process.argv[2] ?? 12);
const seed = Number(process.argv[3] ?? 1);
const fixedA = parseFaction(process.argv[4]);
const fixedB = parseFaction(process.argv[5]);

const pool = loadCards();
console.log(
  `Euphoria simulator — ${games} game(s), base seed ${seed}, factions: ${DECK_FACTIONS.join(", ")}\n`,
);

const pick = (rng: () => number): DeckFaction =>
  DECK_FACTIONS[Math.floor(rng() * DECK_FACTIONS.length)]!;

interface Tagged {
  result: GameResult;
  factions: Record<PlayerId, DeckFaction>;
}

const games_: Tagged[] = [];
for (let i = 0; i < games; i++) {
  const gameSeed = seed + i;
  const rng = createRng(gameSeed);
  const factions: Record<PlayerId, DeckFaction> = {
    player1: fixedA ?? pick(rng),
    player2: fixedB ?? pick(rng),
  };
  const decks = {
    player1: buildFactionDeck(pool, factions.player1, rng),
    player2: buildFactionDeck(pool, factions.player2, rng),
  };
  const result = runGame({
    decks,
    agents: { player1: greedyAgent(), player2: greedyAgent() },
    seed: gameSeed,
  });
  games_.push({ result, factions });
  console.log(
    `game ${String(i + 1).padStart(2)} (seed ${gameSeed}): ` +
      `${factions.player1} vs ${factions.player2} → ` +
      `${result.winner ? `${result.winner} (${factions[result.winner]})` : "draw"} ` +
      `by ${result.reason} — ${result.turns} turns, lives ${result.finalLives.player1}-${result.finalLives.player2}`,
  );
}

const wins = (p: PlayerId) => games_.filter((g) => g.result.winner === p).length;
const draws = games_.filter((g) => g.result.winner === null).length;
const avg = (pick_: (g: Tagged) => number) =>
  (games_.reduce((s, g) => s + pick_(g), 0) / games_.length).toFixed(1);

console.log(
  `\nseat summary: player1 ${wins("player1")} | player2 ${wins("player2")} | draws ${draws}` +
    `  ·  avg ${avg((g) => g.result.turns)} turns / ${avg((g) => g.result.actions)} actions`,
);

console.log("faction record (wins-losses, draws split out):");
for (const f of DECK_FACTIONS) {
  let w = 0;
  let l = 0;
  for (const g of games_) {
    const played = (["player1", "player2"] as const).filter(
      (p) => g.factions[p] === f,
    );
    for (const p of played) {
      if (g.result.winner === p) w += 1;
      else if (g.result.winner !== null) l += 1;
    }
  }
  if (w + l > 0) console.log(`  ${f.padEnd(7)} ${w}-${l}`);
}
