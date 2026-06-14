/**
 * Monk weakness validation: runs the Monk matchups under the current greedy
 * agent and the smarter agent, with Monk in both seats, and aggregates
 * Monk-perspective stats. Pure instrumentation — it changes no card data,
 * stats, or deck rules; it only swaps which agent plays.
 *
 * The question it answers: does Monk's deficit shrink materially under smarter
 * play (a policy artifact) or hold (an intrinsic card-power gap)?
 */
import type { Card } from "@euphoria/card-data";
import { createRng, type PlayerId } from "@euphoria/game-engine";
import { greedyAgent, smartAgent, type Agent } from "./agents";
import { buildFactionDeck, type DeckFaction } from "./deck";
import { runGame } from "./runner";

const MONK_OPPONENTS = ["Dwarf", "Sonic", "Surfer"] as const;
type Opponent = (typeof MONK_OPPONENTS)[number];

/** Monk-perspective running totals; rates/averages are derived in the formatter. */
export interface MonkAggregate {
  games: number;
  wins: number;
  p1Games: number;
  p1Wins: number;
  p2Games: number;
  p2Wins: number;
  turns: number;
  summons: number;
  warriorsLost: number;
  directAttacks: number;
}

export interface MonkAgentResult {
  label: string;
  byOpponent: Record<Opponent, MonkAggregate>;
  overall: MonkAggregate;
  /** Mirror is a seat-fairness check, not a Monk win rate (a Monk always wins). */
  mirrorGames: number;
  mirrorPlayer1Wins: number;
}

function emptyAggregate(): MonkAggregate {
  return {
    games: 0,
    wins: 0,
    p1Games: 0,
    p1Wins: 0,
    p2Games: 0,
    p2Wins: 0,
    turns: 0,
    summons: 0,
    warriorsLost: 0,
    directAttacks: 0,
  };
}

/** Adds one game's Monk-perspective numbers into an aggregate. */
function record(
  agg: MonkAggregate,
  monkSeat: PlayerId,
  result: ReturnType<typeof runGame>,
): void {
  const isP1 = monkSeat === "player1";
  agg.games += 1;
  if (isP1) agg.p1Games += 1;
  else agg.p2Games += 1;
  if (result.winner === monkSeat) {
    agg.wins += 1;
    if (isP1) agg.p1Wins += 1;
    else agg.p2Wins += 1;
  }
  agg.turns += result.turns;
  agg.summons += result.summons[monkSeat];
  agg.warriorsLost += result.warriorsLost[monkSeat];
  agg.directAttacks += result.directAttacks[monkSeat];
}

function playGame(
  pool: Card[],
  p1: DeckFaction,
  p2: DeckFaction,
  gameSeed: number,
  makeAgent: () => Agent,
): ReturnType<typeof runGame> {
  const rng = createRng(gameSeed);
  return runGame({
    decks: {
      player1: buildFactionDeck(pool, p1, rng),
      player2: buildFactionDeck(pool, p2, rng),
    },
    agents: { player1: makeAgent(), player2: makeAgent() },
    seed: gameSeed,
  });
}

/** Runs every Monk matchup (both seats) for one agent over the given seeds. */
function runForAgent(
  pool: Card[],
  seeds: readonly number[],
  label: string,
  makeAgent: () => Agent,
): MonkAgentResult {
  const byOpponent = Object.fromEntries(
    MONK_OPPONENTS.map((o) => [o, emptyAggregate()]),
  ) as Record<Opponent, MonkAggregate>;
  const overall = emptyAggregate();
  let mirrorGames = 0;
  let mirrorPlayer1Wins = 0;

  seeds.forEach((seed, seedIndex) => {
    MONK_OPPONENTS.forEach((opp, oppIndex) => {
      const base = seed + seedIndex * 10_000 + oppIndex * 1000;
      // Monk as Player 1.
      const asP1 = playGame(pool, "Monk", opp, base + 1, makeAgent);
      record(byOpponent[opp], "player1", asP1);
      record(overall, "player1", asP1);
      // Monk as Player 2.
      const asP2 = playGame(pool, opp, "Monk", base + 2, makeAgent);
      record(byOpponent[opp], "player2", asP2);
      record(overall, "player2", asP2);
    });
    // Mirror: a seat-fairness check (a Monk always wins, so track P1 share).
    const mirror = playGame(pool, "Monk", "Monk", seed + seedIndex * 10_000 + 9000, makeAgent);
    mirrorGames += 1;
    if (mirror.winner === "player1") mirrorPlayer1Wins += 1;
  });

  return { label, byOpponent, overall, mirrorGames, mirrorPlayer1Wins };
}

export interface MonkComparison {
  seeds: number;
  greedy: MonkAgentResult;
  smart: MonkAgentResult;
}

/** Runs the full comparison under both agents. Deterministic for given seeds. */
export function compareMonk(pool: Card[], seeds: readonly number[]): MonkComparison {
  return {
    seeds: seeds.length,
    greedy: runForAgent(pool, seeds, "greedy", greedyAgent),
    smart: runForAgent(pool, seeds, "smart", smartAgent),
  };
}

const pct = (n: number, of: number): string =>
  of > 0 ? `${((100 * n) / of).toFixed(1)}%` : "—";
const avg = (n: number, of: number): string =>
  of > 0 ? (n / of).toFixed(1) : "—";

function aggregateLine(label: string, a: MonkAggregate): string {
  return (
    `  ${label.padEnd(16)} ` +
    `win ${pct(a.wins, a.games).padStart(6)}  ` +
    `(P1 ${pct(a.p1Wins, a.p1Games).padStart(6)} | P2 ${pct(a.p2Wins, a.p2Games).padStart(6)})  ` +
    `turns ${avg(a.turns, a.games).padStart(4)}  ` +
    `summon ${avg(a.summons, a.games).padStart(4)}  ` +
    `lost ${avg(a.warriorsLost, a.games).padStart(4)}  ` +
    `direct ${avg(a.directAttacks, a.games).padStart(4)}`
  );
}

function agentSection(result: MonkAgentResult): string[] {
  const lines: string[] = [];
  lines.push(`[${result.label} agent]`);
  for (const opp of MONK_OPPONENTS) {
    lines.push(aggregateLine(`vs ${opp}`, result.byOpponent[opp]));
  }
  lines.push(aggregateLine("OVERALL (vs field)", result.overall));
  lines.push(
    `  ${"mirror (P1 win)".padEnd(16)} ${pct(result.mirrorPlayer1Wins, result.mirrorGames)} — seat-fairness check`,
  );
  return lines;
}

/** Renders the comparison as a readable terminal block. */
export function formatMonkComparison(cmp: MonkComparison): string {
  const lines: string[] = [];
  lines.push("=== Monk smarter-agent validation (instrumentation only) ===");
  lines.push(
    `${cmp.seeds} seed(s) × 3 opponents × 2 seats + mirror, per agent · greedy vs smart`,
  );
  lines.push("");
  lines.push(...agentSection(cmp.greedy));
  lines.push("");
  lines.push(...agentSection(cmp.smart));
  lines.push("");
  const g = cmp.greedy.overall;
  const s = cmp.smart.overall;
  const delta = (100 * s.wins) / s.games - (100 * g.wins) / g.games;
  lines.push(
    `Monk overall win rate: greedy ${pct(g.wins, g.games)} → smart ${pct(s.wins, s.games)} ` +
      `(${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts)`,
  );
  return lines.join("\n");
}
