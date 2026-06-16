/**
 * Interactive (human-controlled) match controller. PURE: no DOM, no network.
 *
 * Mirrors the simulator's game loop (apps/simulator/src/runner.ts), but instead
 * of letting an Agent pick player1's action it waits for the human to apply one
 * via {@link PlayableMatch.apply}. The AI opponent (player2) is driven by the
 * existing `smartAgent` automatically: whenever control passes to player2, the
 * controller runs its whole turn before handing back to the human.
 *
 * Legality is never re-derived here — callers act on the exact actions returned
 * by `getLegalActions`, and the engine's `applyAction` validates everything. On
 * game over the controller produces the *same* {@link MatchSummary} the auto-sim
 * produces (via the simulator's `buildGameResult` + match.ts's `summarizeMatch`),
 * so the downstream result/history/reward flow is identical.
 */
import type { Card } from "@euphoria/card-data/schema";
import {
  applyAction,
  createGame,
  createRng,
  getLegalActions,
  type GameAction,
  type GameState,
} from "@euphoria/game-engine";
import { buildGameResult, smartAgent, type EndReason } from "@euphoria/simulator";
import {
  expandStarterDeck,
  pickOpponentFaction,
  summarizeMatch,
  OPPONENT_SEAT,
  PLAYER_SEAT,
  type MatchSummary,
} from "./match";
import { expandDeckEntries } from "./deck-builder";
import type { DeckEntry, StarterFaction } from "./starter";

/** Options for {@link createPlayableMatch}. */
export interface PlayableMatchOptions {
  readonly faction: StarterFaction;
  readonly pool: readonly Card[];
  /** Fixed seed for reproducible matches; defaults to a random seed. */
  readonly seed?: number;
  /** Force the opponent faction (mainly for tests); otherwise chosen randomly. */
  readonly opponentFaction?: StarterFaction;
  /**
   * The player's deck. When provided (the saved custom deck) player1 is built
   * from it; otherwise player1 uses the faction's fixed starter deck. The caller
   * validates it first — only the input deck changes, never the engine logic.
   */
  readonly playerDeck?: readonly DeckEntry[];
  /**
   * Safety cap on the opponent's actions within a single turn, guarding against
   * a pathological AI loop that never ends its turn. Default 200.
   */
  readonly maxOpponentActionsPerTurn?: number;
}

/** Result of applying a human action: ok, or the engine's rejection message. */
export type ApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** A human-controlled match in progress. All reads reflect the latest state. */
export interface PlayableMatch {
  readonly playerFaction: StarterFaction;
  readonly opponentFaction: StarterFaction;
  readonly seed: number;
  /** The current engine state (read-only snapshot for rendering). */
  state(): GameState;
  /** True once the game has a winner or has been capped (see {@link summary}). */
  isOver(): boolean;
  /**
   * The legal actions the human may take right now. Empty when the game is over
   * or while it is the opponent's turn (the controller runs that automatically).
   */
  legalActions(): GameAction[];
  /** Applies one human action, then auto-runs the opponent if the turn passed. */
  apply(action: GameAction): ApplyResult;
  /** The display-ready summary; only meaningful once {@link isOver} is true. */
  summary(): MatchSummary;
}

/**
 * Builds both decks exactly as the auto-sim does (frozen starter recipes, or the
 * supplied custom deck for player1), starts the game, and returns a controller.
 * The human is always player1; the AI opponent is player2.
 */
export function createPlayableMatch(
  options: PlayableMatchOptions,
): PlayableMatch {
  const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const rng = createRng(seed);
  const opponentFaction =
    options.opponentFaction ?? pickOpponentFaction(options.faction, rng);
  const opponentCap = options.maxOpponentActionsPerTurn ?? 200;

  const playerDeck =
    options.playerDeck !== undefined
      ? expandDeckEntries(options.playerDeck, options.pool)
      : expandStarterDeck(options.faction, options.pool);

  let state = createGame({
    decks: {
      player1: playerDeck,
      player2: expandStarterDeck(opponentFaction, options.pool),
    },
    seed,
  });

  const agent = smartAgent();
  let actions = 0;
  // Set when an opponent turn hits the per-turn cap without ending — recorded so
  // the summary's reason reflects the stall rather than claiming a clean finish.
  let stalled = false;

  // Drives the opponent (player2) through its entire turn: ask the engine for
  // legal actions, let smartAgent choose, apply, repeat until control returns to
  // the human or the game ends. The same contract as the simulator loop — an
  // agent that returns an illegal action is a bug surfaced as a thrown error.
  const runOpponent = (): void => {
    let steps = 0;
    while (
      state.winner === null &&
      state.activePlayer === OPPONENT_SEAT
    ) {
      if (steps >= opponentCap) {
        stalled = true;
        break;
      }
      const legal = getLegalActions(state);
      if (legal.length === 0) break;
      const choice = agent(state, legal);
      const result = applyAction(state, choice);
      if (!result.ok) {
        throw new Error(
          `AI opponent chose an illegal ${choice.kind}: ${result.error.message}`,
        );
      }
      state = result.state;
      actions += 1;
      steps += 1;
    }
  };

  return {
    playerFaction: options.faction,
    opponentFaction,
    seed,
    state: () => state,
    isOver: () => state.winner !== null || stalled,
    legalActions: () =>
      state.winner === null && state.activePlayer === PLAYER_SEAT
        ? getLegalActions(state)
        : [],
    apply: (action) => {
      if (state.winner !== null) {
        return { ok: false, message: "The match is already over." };
      }
      if (state.activePlayer !== PLAYER_SEAT) {
        return { ok: false, message: "It is not your turn." };
      }
      const result = applyAction(state, action);
      if (!result.ok) {
        return { ok: false, message: result.error.message };
      }
      state = result.state;
      actions += 1;
      // If that action ended the human's turn, play out the opponent's reply.
      if (state.activePlayer === OPPONENT_SEAT) runOpponent();
      return { ok: true };
    },
    summary: () => {
      const reason: EndReason = stalled ? "maxActions" : "win";
      const result = buildGameResult(state, { reason, actions });
      return summarizeMatch(options.faction, opponentFaction, result, seed);
    },
  };
}

/** Re-exported for callers that only want the seat constants. */
export { PLAYER_SEAT, OPPONENT_SEAT };
