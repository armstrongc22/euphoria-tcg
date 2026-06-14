/**
 * The simulator game loop. Drives a full game through the engine's public API:
 * ask `getLegalActions`, let the active player's Agent choose, `applyAction`,
 * repeat until someone wins or a safety cap trips. The loop holds no rules of
 * its own — every decision is validated by the engine, and an Agent that
 * returns an illegal action is a bug, surfaced as a thrown error.
 */
import type { Card } from "@euphoria/card-data";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameState,
  type PlayerId,
  type RulesConfig,
} from "@euphoria/game-engine";
import type { Agent } from "./agents";

export interface GameSetup {
  decks: Record<PlayerId, Card[]>;
  agents: Record<PlayerId, Agent>;
  seed?: number;
  config?: Partial<RulesConfig>;
  /** Hard cap on turns before the game is called a draw. Default 200. */
  maxTurns?: number;
  /** Hard cap on total actions, guarding against a stuck turn. Default 5000. */
  maxActions?: number;
}

export type EndReason = "win" | "maxTurns" | "maxActions" | "noLegalActions";

export interface GameResult {
  winner: PlayerId | null;
  reason: EndReason;
  turns: number;
  actions: number;
  events: number;
  finalLives: Record<PlayerId, number>;
}

/** Runs one game to completion (or to a safety cap) and reports the outcome. */
export function runGame(setup: GameSetup): GameResult {
  const maxTurns = setup.maxTurns ?? 200;
  const maxActions = setup.maxActions ?? 5000;

  let state: GameState = createGame({
    decks: setup.decks,
    seed: setup.seed,
    config: setup.config,
  });

  let actions = 0;
  let reason: EndReason = "maxTurns";
  while (state.winner === null) {
    if (state.turn > maxTurns) {
      reason = "maxTurns";
      break;
    }
    if (actions >= maxActions) {
      reason = "maxActions";
      break;
    }
    const legal = getLegalActions(state);
    if (legal.length === 0) {
      reason = "noLegalActions";
      break;
    }
    const action = setup.agents[state.activePlayer](state, legal);
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `Agent for ${state.activePlayer} chose an illegal ${action.kind}: ${result.error.message}`,
      );
    }
    state = result.state;
    actions += 1;
  }

  return {
    winner: state.winner,
    reason: state.winner !== null ? "win" : reason,
    turns: state.turn,
    actions,
    events: state.events.length,
    finalLives: {
      player1: state.players.player1.lives,
      player2: state.players.player2.lives,
    },
  };
}
