/**
 * Local test-match logic. PURE (no DOM, no network): given the player's chosen
 * faction and the card pool, it builds both decks from the frozen starter
 * recipes (./starter), picks a valid opponent faction, runs one game through
 * the existing simulator loop (`runGame` from @euphoria/simulator), and reduces
 * the raw GameResult to a small, display-ready summary.
 *
 * This is a beta demo: the match is entirely client-side, nothing is persisted,
 * no cards are awarded, and no card data / recipes / balance are touched — the
 * decks are exactly the curated starter decks the player already sees.
 */
import type { Card } from "@euphoria/card-data/schema";
import { createRng, type PlayerId } from "@euphoria/game-engine";
import { runGame, smartAgent, type EndReason, type GameResult } from "@euphoria/simulator";
import {
  getRecipe,
  resolveDeck,
  STARTER_FACTIONS,
  type DeckEntry,
  type StarterFaction,
} from "@euphoria/core/starter";
import { expandDeckEntries } from "./deck-builder";

/** The player is always seat player1; the AI opponent is player2. */
export const PLAYER_SEAT: PlayerId = "player1";
export const OPPONENT_SEAT: PlayerId = "player2";

/** A win/loss/draw for the human player. */
export type MatchOutcome = "win" | "loss" | "draw";

/** Display-ready result of one local test match. */
export interface MatchSummary {
  readonly playerFaction: StarterFaction;
  readonly opponentFaction: StarterFaction;
  /** Outcome from the player's point of view. */
  readonly outcome: MatchOutcome;
  /** Convenience flag: did the player win? */
  readonly playerWon: boolean;
  /** Who won, as a label for the UI ("You", the opponent faction, or "Draw"). */
  readonly winnerLabel: string;
  /** Turns played before the game ended. */
  readonly turns: number;
  /** A short, human-readable event/result recap. */
  readonly highlights: readonly string[];
  /** The raw engine result, for callers that want the full detail. */
  readonly result: GameResult;
  /** The seed the match was run with (so a result can be reproduced). */
  readonly seed: number;
}

/** Options for {@link runTestMatch}. */
export interface TestMatchOptions {
  readonly faction: StarterFaction;
  readonly pool: readonly Card[];
  /** Fixed seed for reproducible matches; defaults to a random seed. */
  readonly seed?: number;
  /** Force the opponent faction (mainly for tests); otherwise chosen randomly. */
  readonly opponentFaction?: StarterFaction;
  /**
   * The player's deck to use. When provided (the saved custom deck), player1 is
   * built from it; otherwise player1 uses the faction's fixed starter deck. The
   * caller is responsible for validating it first — only the input deck changes,
   * the simulator outcome logic is untouched.
   */
  readonly playerDeck?: readonly DeckEntry[];
}

/**
 * Expands a faction's frozen starter recipe into a flat 30-card deck: each
 * recipe entry contributes `quantity` copies of the same Card. Throws (via
 * resolveDeck) if a recipe slug is missing from the pool, so a bad pool fails
 * loudly rather than at game time.
 */
export function expandStarterDeck(
  faction: StarterFaction,
  pool: readonly Card[],
): Card[] {
  const deck: Card[] = [];
  for (const { card, quantity } of resolveDeck(getRecipe(faction), pool)) {
    for (let i = 0; i < quantity; i++) deck.push(card);
  }
  return deck;
}

/**
 * Picks a starter faction for the AI opponent, excluding the player's own
 * faction when possible (it always is — there are four factions). Seeded via
 * the passed rng so a given seed reproduces the same opponent.
 */
export function pickOpponentFaction(
  playerFaction: StarterFaction,
  rng: () => number,
): StarterFaction {
  const others = STARTER_FACTIONS.filter((f) => f !== playerFaction);
  const choices = others.length > 0 ? others : STARTER_FACTIONS;
  return choices[Math.floor(rng() * choices.length)]!;
}

/** Human-readable phrase for why a non-win game ended. */
function reasonText(reason: EndReason): string {
  switch (reason) {
    case "win":
      return "a decisive blow";
    case "maxTurns":
      return "the turn limit (stalemate)";
    case "maxActions":
      return "the action limit (stalemate)";
    case "noLegalActions":
      return "neither side having a legal move";
  }
}

/**
 * Reduces a raw engine result to the display-ready {@link MatchSummary}.
 * Exported so an interactive, human-controlled match (./play-match) can produce
 * the exact same summary shape the auto-sim does, keeping the result/history/
 * reward flow identical regardless of how the game was played.
 */
export function summarizeMatch(
  playerFaction: StarterFaction,
  opponentFaction: StarterFaction,
  result: GameResult,
  seed: number,
): MatchSummary {
  const playerWon = result.winner === PLAYER_SEAT;
  const outcome: MatchOutcome =
    result.winner === null ? "draw" : playerWon ? "win" : "loss";
  const winnerLabel =
    result.winner === null ? "Draw" : playerWon ? "You" : opponentFaction;

  const highlights: string[] = [];
  if (outcome === "draw") {
    highlights.push(
      `No winner after ${result.turns} turns — ended by ${reasonText(result.reason)}.`,
    );
  } else {
    const how = result.winByDirectAttack
      ? "by direct attack"
      : `by ${reasonText(result.reason)}`;
    const who = playerWon ? "You won" : `${opponentFaction} won`;
    highlights.push(`${who} ${how} on turn ${result.turns}.`);
  }
  highlights.push(
    `Lives left — you ${result.finalLives[PLAYER_SEAT]}, ` +
      `opponent ${result.finalLives[OPPONENT_SEAT]}.`,
  );
  highlights.push(
    `Warriors summoned — you ${result.summons[PLAYER_SEAT]}, ` +
      `opponent ${result.summons[OPPONENT_SEAT]}.`,
  );
  highlights.push(
    `Direct attacks — you ${result.directAttacks[PLAYER_SEAT]}, ` +
      `opponent ${result.directAttacks[OPPONENT_SEAT]}.`,
  );

  return {
    playerFaction,
    opponentFaction,
    outcome,
    playerWon,
    winnerLabel,
    turns: result.turns,
    highlights,
    result,
    seed,
  };
}

/**
 * Runs one local test match for the given faction against a randomly chosen AI
 * opponent and returns a display-ready summary. Deterministic for a fixed seed.
 */
export function runTestMatch(options: TestMatchOptions): MatchSummary {
  const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const rng = createRng(seed);
  const opponentFaction =
    options.opponentFaction ?? pickOpponentFaction(options.faction, rng);

  // The player's deck is their saved custom deck when provided, else the fixed
  // starter deck. The opponent always uses its faction's starter deck.
  const playerDeck =
    options.playerDeck !== undefined
      ? expandDeckEntries(options.playerDeck, options.pool)
      : expandStarterDeck(options.faction, options.pool);

  // Explicit player1/player2 keys: the engine's Record<PlayerId, …> needs the
  // literal seats, which a computed-key object would widen to an index signature.
  const result = runGame({
    decks: {
      player1: playerDeck,
      player2: expandStarterDeck(opponentFaction, options.pool),
    },
    agents: { player1: smartAgent(), player2: smartAgent() },
    seed,
  });

  return summarizeMatch(options.faction, opponentFaction, result, seed);
}
