import type { Card } from "@euphoria/card-data";
import type { GameEvent } from "./events";

export type PlayerId = "player1" | "player2";

export const PLAYER_IDS: readonly PlayerId[] = ["player1", "player2"];

/**
 * Phases per docs/rules-spec.md. The draw happens inside the Start Phase
 * (Spirit gain first, then draw). "start" and "end" only exist transiently
 * while the engine resolves them; between actions the game rests in "main"
 * or "battle".
 */
export type Phase = "start" | "main" | "battle" | "end";

/** Ported from DEFAULT_RULES in the archived Python engine. */
export interface RulesConfig {
  /** 30 */
  deckSize: number;
  /** 5 */
  startingHandSize: number;
  /** 1 — the start-of-turn gain also fires on turn 1, so P1 begins play at 2 */
  startingSpirit: number;
  /** 1, gained at the start of turn before drawing */
  spiritGainPerTurn: number;
  /** null = uncapped */
  maxSpirit: number | null;
  /** 3 */
  startingLives: number;
  /** 5 — Python engine value, adopted per project decision */
  warriorSlots: number;
  noAttacksOnFirstTurn: boolean;
  /** 1 */
  directAttackLimitPerTurn: number;
  warriorsCanAttackTurnSummoned: boolean;
  /** false — attacker takes no counter damage (CLAUDE.md overrides the spec) */
  combatDamageSimultaneous: boolean;
  /** false — Attack cards are never offered on direct attacks */
  attackCardsOnDirectAttacks: boolean;
  oneWeaponPerWarrior: boolean;
}

/** Python engine's "temporary_attack_buffs" status; expires at the start of the owner's next turn. */
export interface TemporaryAttackBuff {
  amount: number;
}

/** Python engine's Permanent: a Warrior on the field. */
export interface WarriorInPlay {
  /** Unique per game so duplicate cards on the field stay distinguishable. */
  instanceId: string;
  card: Card;
  currentAttack: number;
  currentHealth: number;
  maxHealth: number;
  /**
   * Attacks left this turn (default 1). Decremented by each attack or
   * direct attack; reset to 1 at the start of the owner's turn. Effects
   * may grant extras, which expire at the end of the owner's turn.
   */
  attacksRemaining: number;
  /** One Weapon per Warrior; it cannot be replaced or moved and dies with the Warrior. */
  attachedWeapon?: Card;
  temporaryAttackBuffs: TemporaryAttackBuff[];
}

export interface DelayedEffect {
  type: "gainSpirit";
  amount: number;
  /** Decremented at the start of the owner's turn; resolves when it reaches 0. */
  turnsRemaining: number;
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
  directAttackUsedThisTurn: boolean;
  delayedEffects: DelayedEffect[];
}

export interface GameState {
  config: RulesConfig;
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  winner: PlayerId | null;
  /** Append-only structured log (the Python engine's print-based log). */
  events: GameEvent[];
  /** Counter for unique WarriorInPlay instance ids. */
  nextInstanceId: number;
}

export type GameAction =
  | { kind: "playWarrior"; cardId: string }
  | {
      kind: "playItem";
      cardId: string;
      targetPlayer?: PlayerId;
      targetInstanceId?: string;
      /** Card id in the player's own Out Deck (e.g. the Warrior to revive). */
      targetOutDeckCardId?: string;
      /** Card id in the player's own deck (e.g. the search target). */
      targetDeckCardId?: string;
    }
  | { kind: "equipWeapon"; cardId: string; warriorInstanceId: string }
  /**
   * If the attacking player holds a compatible (same-faction, affordable)
   * Attack card, the action must carry either selectedAttackCardId (a card
   * id from hand) or skipAttackCard: true. Hand cards have no instance ids;
   * duplicates are identical, so selecting by card id consumes one copy.
   */
  | {
      kind: "attack";
      attackerInstanceId: string;
      defenderInstanceId: string;
      selectedAttackCardId?: string;
      skipAttackCard?: boolean;
      /**
       * Explicit target for the selected Attack card's effect (e.g. which
       * Warrior to destroy). Defaults per handler, usually the defender.
       */
      effectTargetInstanceId?: string;
    }
  | { kind: "directAttack"; attackerInstanceId: string }
  | { kind: "enterBattle" }
  | { kind: "endTurn" };
