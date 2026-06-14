/**
 * Agents: policies that pick one action from the legal set the engine offers.
 * An Agent never has to know the rules — it only ranks/chooses among
 * `getLegalActions(state)`, so the engine stays the single source of legality.
 */
import { createRng, type GameAction, type GameState } from "@euphoria/game-engine";

/** Chooses one of the currently legal actions. Must return a member of `legal`. */
export type Agent = (state: GameState, legal: readonly GameAction[]) => GameAction;

/** Uniformly random over the legal actions, seeded for reproducibility. */
export function randomAgent(seed: number): Agent {
  const rng = createRng(seed);
  return (_state, legal) => legal[Math.floor(rng() * legal.length)]!;
}

/**
 * Aggression ranking for the greedy agent: spend life off the opponent when
 * possible, else trade on the board, else develop, else pass. Higher wins.
 */
const PRIORITY: Record<GameAction["kind"], number> = {
  directAttack: 7,
  attack: 6,
  playWarrior: 5,
  enterBattle: 4,
  equipWeapon: 3,
  reclaimWarrior: 2,
  playItem: 1,
  endTurn: 0,
};

/**
 * A deterministic, aggressive baseline: always takes the highest-priority
 * legal action. It develops its board in Main Phase, then enters Battle and
 * attacks until exhausted, only ending the turn when nothing better remains —
 * enough to drive games to a winner without any lookahead.
 */
export function greedyAgent(): Agent {
  return (_state, legal) =>
    [...legal].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind])[0]!;
}
