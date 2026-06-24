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
  type GameEvent,
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
import type { DeckEntry, StarterFaction } from "@euphoria/core/starter";

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
  /**
   * Player actions to re-apply on construction, fast-forwarding the match to a
   * previously-saved point (see {@link PlayableMatch.history}). The match is
   * deterministic for a fixed seed/deck and the opponent (smartAgent) is a pure
   * function of state, so replaying the human's actions reproduces the exact
   * same game — this is how an interrupted match is resumed. Throws
   * {@link ReplayError} if any action no longer applies (e.g. data changed), so
   * the caller can discard the stale save and start fresh instead of crashing.
   */
  readonly replay?: readonly GameAction[];
}

/** Thrown when {@link PlayableMatchOptions.replay} can't be re-applied cleanly. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/**
 * One resolved action's snapshot: the engine state immediately after it, the
 * events it produced (the delta), and who acted. Returned in order from
 * {@link PlayableMatch.apply} so the UI can play actions back progressively
 * (the human's action first, then each of the opponent's). The state is a
 * distinct post-action object (applyAction never mutates its input), so frames
 * are safe to render as a sequence of board snapshots.
 */
export interface MatchFrame {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly actor: "player" | "opponent";
}

/** Result of applying a human action: ok with the resolved frames, or an error. */
export type ApplyResult =
  | { readonly ok: true; readonly frames: MatchFrame[] }
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
  /**
   * Applies one human action, then auto-runs the opponent if the turn passed.
   * Returns the resolved frames in order (human first, then the opponent's), so
   * the caller can play them back rather than jumping straight to the result.
   */
  apply(action: GameAction): ApplyResult;
  /**
   * The ordered list of human actions applied so far. Combined with the match's
   * seed/faction/deck this fully determines the game, so it's what gets persisted
   * for resume (replayed via {@link PlayableMatchOptions.replay}).
   */
  history(): GameAction[];
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
  // The human actions applied so far, in order — the resume/replay record.
  const playerActions: GameAction[] = [];
  // Set when an opponent turn hits the per-turn cap without ending — recorded so
  // the summary's reason reflects the stall rather than claiming a clean finish.
  let stalled = false;

  // Drives the opponent (player2) through its entire turn: ask the engine for
  // legal actions, let smartAgent choose, apply, repeat until control returns to
  // the human or the game ends. The same contract as the simulator loop — an
  // agent that returns an illegal action is a bug surfaced as a thrown error.
  const runOpponent = (frames: MatchFrame[]): void => {
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
      const before = state.events.length;
      const result = applyAction(state, choice);
      if (!result.ok) {
        throw new Error(
          `AI opponent chose an illegal ${choice.kind}: ${result.error.message}`,
        );
      }
      state = result.state;
      actions += 1;
      steps += 1;
      frames.push({
        state,
        events: state.events.slice(before),
        actor: "opponent",
      });
    }
  };

  // Core human-action application, shared by the public apply() and by replay.
  // Records the action (for resume) and runs the opponent if the turn passed.
  const applyPlayerAction = (action: GameAction): ApplyResult => {
    if (state.winner !== null) {
      return { ok: false, message: "The match is already over." };
    }
    if (state.activePlayer !== PLAYER_SEAT) {
      return { ok: false, message: "It is not your turn." };
    }
    const before = state.events.length;
    const result = applyAction(state, action);
    if (!result.ok) {
      return { ok: false, message: result.error.message };
    }
    state = result.state;
    actions += 1;
    playerActions.push(action);
    const frames: MatchFrame[] = [
      { state, events: state.events.slice(before), actor: "player" },
    ];
    // If that action ended the human's turn, play out the opponent's reply,
    // capturing each of its actions as its own frame for progressive playback.
    if (state.activePlayer === OPPONENT_SEAT) runOpponent(frames);
    return { ok: true, frames };
  };

  // Resume: fast-forward through previously-saved actions. A failure means the
  // save no longer fits this build (e.g. data changed) — surface it so the caller
  // can discard it rather than resume into a corrupt state.
  if (options.replay !== undefined) {
    for (const action of options.replay) {
      const res = applyPlayerAction(action);
      if (!res.ok) {
        throw new ReplayError(`Could not resume match: ${res.message}`);
      }
    }
  }

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
    apply: applyPlayerAction,
    history: () => [...playerActions],
    summary: () => {
      const reason: EndReason = stalled ? "maxActions" : "win";
      const result = buildGameResult(state, { reason, actions });
      return summarizeMatch(options.faction, opponentFaction, result, seed);
    },
  };
}

/** Re-exported for callers that only want the seat constants. */
export { PLAYER_SEAT, OPPONENT_SEAT };
