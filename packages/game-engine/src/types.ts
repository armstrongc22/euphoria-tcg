/**
 * Placeholder types for the Euphoria rules engine. No game logic lives here
 * yet; these shapes encode the current rules so the engine can be built
 * against them incrementally (with tests for every rules change).
 */
import type { Card } from "@euphoria/card-data";

export type PlayerId = "player1" | "player2";

/** Spirit gain happens at start of turn, before draw. */
export type Phase = "start" | "draw" | "main" | "battle" | "end";

export interface RulesConfig {
  /** 30 */
  deckSize: number;
  /** 5 */
  startingHandSize: number;
  /** 1 */
  startingSpirit: number;
  /** 3 */
  startingLives: number;
  /** 1 — direct attacks allowed per turn */
  directAttackLimitPerTurn: number;
}

export interface WarriorInPlay {
  /** Unique per game so duplicate cards on the field stay distinguishable. */
  instanceId: string;
  card: Card;
  /** One Weapon per Warrior; it cannot be replaced or moved and dies with the Warrior. */
  attachedWeapon?: Card;
  damageTaken: number;
  /** Warriors may attack the turn they are summoned. */
  summonedThisTurn: boolean;
  hasAttackedThisTurn: boolean;
}

export interface PlayerState {
  id: PlayerId;
  lives: number;
  spirit: number;
  deck: Card[];
  hand: Card[];
  field: WarriorInPlay[];
  /** Used Items/Attacks and destroyed Warriors/Weapons. */
  outDeck: Card[];
  directAttacksThisTurn: number;
}

export interface GameState {
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  /** Once the battle stage begins, Items and Weapons cannot be played. */
  battleStageStarted: boolean;
}

export type GameAction =
  | { kind: "playWarrior"; cardId: string }
  | { kind: "playItem"; cardId: string }
  | { kind: "playAttack"; cardId: string; targetInstanceId?: string }
  | { kind: "equipWeapon"; cardId: string; warriorInstanceId: string }
  /** No defender = direct attack (only legal if opponent has no Warriors). */
  | { kind: "attack"; attackerInstanceId: string; defenderInstanceId?: string }
  | { kind: "endTurn" };
