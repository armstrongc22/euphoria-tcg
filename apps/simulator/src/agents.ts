/**
 * Agents: policies that pick one action from the legal set the engine offers.
 * An Agent never has to know the rules — it only ranks/chooses among
 * `getLegalActions(state)`, so the engine stays the single source of legality.
 */
import {
  createRng,
  opponentOf,
  type GameAction,
  type GameState,
} from "@euphoria/game-engine";

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

/**
 * A slightly smarter, still-deterministic agent. It keeps greedy's aggression
 * order between action *kinds*, but breaks ties with cheap heuristics that
 * target the diagnosed tempo problem:
 *  - Summon the *cheapest* affordable Warrior first, so a turn's Spirit buys
 *    the most bodies (board presence) instead of one over-priced Warrior.
 *  - Attack to *kill*: prefer hits that destroy the defender, and among those
 *    remove the biggest-ATTACK threat — efficient since attackers take no
 *    counter damage.
 * It never looks ahead and only ever returns a legal action; it just ranks
 * the legal set more thoughtfully than greedy.
 */
export function smartAgent(): Agent {
  return (state, legal) => {
    let best = legal[0]!;
    let bestScore = -Infinity;
    for (const action of legal) {
      const score = scoreAction(state, action);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  };
}

/** Higher = more preferred. Kind bands mirror greedy; ties use board sense. */
function scoreAction(state: GameState, action: GameAction): number {
  const me = state.activePlayer;
  switch (action.kind) {
    case "directAttack":
      return 7000;
    case "attack": {
      const attacker = state.players[me].field.find(
        (w) => w.instanceId === action.attackerInstanceId,
      );
      const defender = state.players[opponentOf(me)].field.find(
        (w) => w.instanceId === action.defenderInstanceId,
      );
      let score = 6000;
      if (attacker !== undefined && defender !== undefined) {
        if (attacker.currentAttack >= defender.currentHealth) {
          // Lethal: kill, preferring the highest-ATTACK threat removed.
          score += 500 + Math.min(499, defender.currentAttack / 10);
        } else {
          // Non-lethal chip: favour softening the closest-to-dead defender.
          score += Math.max(0, 200 - defender.currentHealth / 50);
        }
      }
      return score;
    }
    case "playWarrior": {
      const card = state.players[me].hand.find((c) => c.id === action.cardId);
      const cost = card?.cost ?? 0;
      // Cheapest first: every point of cost lowers the score a little, so the
      // turn fills the board with bodies before spending Spirit on big ones.
      return 5000 - cost;
    }
    case "enterBattle":
      return 4000;
    case "equipWeapon":
      return 3000;
    case "reclaimWarrior":
      return 2000;
    case "playItem":
      return 1000;
    case "endTurn":
      return 0;
  }
}
