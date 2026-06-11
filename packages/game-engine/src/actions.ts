import { runEndPhase } from "./turn";
import type { GameAction, GameState } from "./types";

export type EngineErrorCode = "WRONG_PHASE" | "GAME_OVER" | "NOT_IMPLEMENTED";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineError };

function fail(code: EngineErrorCode, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * Pure action reducer: validates, then returns a new state (the input state
 * is never mutated). Illegal actions return a typed error instead of throwing.
 */
export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.winner !== null) {
    return fail("GAME_OVER", `The game is over; ${state.winner} won.`);
  }

  switch (action.kind) {
    case "enterBattle": {
      if (state.phase !== "main") {
        return fail(
          "WRONG_PHASE",
          `Battle Phase can only be entered from Main Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      next.phase = "battle";
      next.events.push({ type: "phaseChanged", phase: "battle" });
      return { ok: true, state: next };
    }

    case "endTurn": {
      if (state.phase !== "main" && state.phase !== "battle") {
        return fail(
          "WRONG_PHASE",
          `The turn can only be ended from Main or Battle Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      runEndPhase(next);
      return { ok: true, state: next };
    }

    default:
      return fail(
        "NOT_IMPLEMENTED",
        `Action "${action.kind}" is not implemented yet (card play and combat arrive in later steps).`,
      );
  }
}

/** Enumerates the currently legal (implemented) actions. */
export function getLegalActions(state: GameState): GameAction[] {
  if (state.winner !== null) return [];

  const actions: GameAction[] = [];
  if (state.phase === "main") {
    actions.push({ kind: "enterBattle" });
  }
  if (state.phase === "main" || state.phase === "battle") {
    actions.push({ kind: "endTurn" });
  }
  return actions;
}
