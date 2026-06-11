import type { Card } from "@euphoria/card-data";
import {
  applyAction,
  type GameAction,
  type GameState,
  type PlayerId,
  type WarriorInPlay,
} from "../src/index";

let counter = 0;

export function makeWarriorCard(overrides: Partial<Card> = {}): Card {
  counter += 1;
  const slug = `test-warrior-${counter}`;
  return {
    id: `test_warrior_${counter}`,
    slug,
    name: `Test Warrior ${counter}`,
    faction: "Monk",
    type: "Warrior",
    spiritCost: 1,
    costResource: "Spirit",
    attack: 1000,
    health: 2000,
    imageFile: `monk/${slug}.png`,
    rarity: "Beta",
    cost: 1,
    effectText: "",
    ...overrides,
  };
}

export function makeDeck(size = 30): Card[] {
  return Array.from({ length: size }, () => makeWarriorCard());
}

export function makeDecks(): Record<PlayerId, Card[]> {
  return { player1: makeDeck(), player2: makeDeck() };
}

/** Test-only: drop a Warrior straight onto a player's field. */
export function putWarriorOnField(
  state: GameState,
  player: PlayerId,
  overrides: Partial<WarriorInPlay> = {},
): WarriorInPlay {
  const card = makeWarriorCard();
  const warrior: WarriorInPlay = {
    instanceId: `instance-${counter}`,
    card,
    currentAttack: card.attack ?? 0,
    currentHealth: card.health ?? 0,
    maxHealth: card.health ?? 0,
    exhausted: false,
    temporaryAttackBuffs: [],
    ...overrides,
  };
  state.players[player].field.push(warrior);
  return warrior;
}

/** Applies an action that the test expects to succeed. */
export function mustApply(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`Expected ${action.kind} to succeed: ${result.error.message}`);
  }
  return result.state;
}
