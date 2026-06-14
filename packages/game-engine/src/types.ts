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
  /**
   * Owner start-of-turn boundaries left before the buff expires; counted
   * down each Start Phase. Unset = 1 (the classic this-turn buff). Multi-
   * turn buffs (Training Arc's "for 2 turns") set 2: the buff covers two
   * of the owner's turns.
   */
  turnsRemaining?: number;
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
  /**
   * Ontology (WEAPON_NEGATE_ONCE_REDUCE_ATTACKER): the game turn on which
   * this Warrior last negated an attack against it. Keyed on the turn number
   * (which is unique per turn) so the "negate 1 attack per turn" limit needs
   * no separate reset. Unset = never negated.
   */
  negatedAttackTurn?: number;
  /**
   * XL-QR517 (TANK_FORM): set while this Warrior is piloting the tank. The
   * Warrior's live stats are the tank's (1500/3100); these snapshot what to
   * restore when the tank is destroyed, at which point the original Warrior
   * returns to the field in place rather than going to the Out Deck. Unset =
   * not in a tank.
   */
  tankForm?: TankForm;
}

/**
 * The original Warrior's stats, stashed while it pilots the tank so they can
 * be restored on the tank's destruction. Temporary attack buffs are dropped
 * on entry (the tank overrides ATTACK), so only the permanent base is kept.
 */
export interface TankForm {
  originalAttack: number;
  originalHealth: number;
  originalMaxHealth: number;
}

/**
 * A pending effect stored on a player and processed at the start of that
 * player's turns (resolveDelayedEffects). Two shapes today:
 * - gainSpirit (Secure Deposits): one-shot — turnsRemaining counts down and
 *   the Spirit is granted when it reaches 0.
 * - lingeringDamage (Silurian Period): recurring — at each of the owner's
 *   start phases it deals `amount` to every still-fielded Warrior in
 *   `targetInstanceIds` on `targetPlayer`'s side, then `turnsRemaining` (the
 *   count of ticks still to fire) decrements; the effect is dropped when it
 *   reaches 0.
 */
export type DelayedEffect =
  | { type: "gainSpirit"; amount: number; turnsRemaining: number }
  | {
      type: "lingeringDamage";
      amount: number;
      turnsRemaining: number;
      targetPlayer: PlayerId;
      targetInstanceIds: string[];
    };

/** What a StatusEffect does; handlers in actions/turn dispatch on this. */
export type StatusCode =
  /** Gorgon's Eye: no attacks (including direct) may be declared by anyone. */
  | "PREVENT_ALL_ATTACKS"
  /** Orange Court: affectedPlayer cannot attack the controller's Warriors of `faction`. */
  | "PREVENT_ATTACKS_AGAINST_FACTION"
  /**
   * High Tea: the Warrior in affectedInstanceId cannot be destroyed; a
   * prevented destruction costs it metadata.penalty health (floored at 1,
   * since the protection is absolute for the turn).
   */
  | "PREVENT_DESTRUCTION"
  /**
   * Heaven's Door Izakaya: dormant until expiry, then all of the
   * controller's `faction` Warriors gain metadata.amount attack for that
   * turn. Delayed statuses fire as a side effect of expiring.
   */
  | "DELAYED_FACTION_ATTACK_BUFF"
  /**
   * Training Arc: dormant until expiry, then the Warrior in
   * affectedInstanceId gains metadata.amount attack for
   * metadata.durationTurns of its owner's turns. Fizzles if the Warrior
   * left the field while pending.
   */
  | "DELAYED_ATTACK_BUFF"
  /**
   * Primetime Interview: while active, the Warrior in affectedInstanceId
   * is the only one affectedPlayer may declare attacks (direct included)
   * with.
   */
  | "RESTRICT_ATTACKER_TO_WARRIOR"
  /**
   * Moral Determination Authrotity, stage 1: while active, every attack
   * declared by one of affectedPlayer's Warriors earns that Warrior a
   * DISABLE_WARRIOR_ATTACKS status.
   */
  | "PUNISH_ATTACKERS_WATCH"
  /**
   * Moral Determination Authrotity, stage 2: dormant until expiry (the
   * start of the punished Warrior's owner's next turn), then sets that
   * Warrior's attacksRemaining to 0 for the turn. Fizzles if the Warrior
   * left the field.
   */
  | "DISABLE_WARRIOR_ATTACKS"
  /**
   * A Dragon's Judgement: while active, any Warrior that attacks a
   * `faction` Warrior loses metadata.amount health after damage resolves
   * (side-agnostic, per the card text's "any Warrior").
   */
  | "RETALIATE_AGAINST_FACTION_ATTACKERS";

/**
 * Which turn boundary a status expires on. "startOfTurn" fires during
 * `expiry.player`'s Start Phase (before Spirit gain and draw); "endOfTurn"
 * fires during their End Phase (before the turn passes).
 */
export type StatusExpiryTiming = "startOfTurn" | "endOfTurn";

export interface StatusExpiry {
  /** Whose turn boundary counts down this status. */
  player: PlayerId;
  timing: StatusExpiryTiming;
  /** Matching boundaries left to pass; the status expires when it reaches 0. */
  turnsRemaining: number;
}

/**
 * A temporary game-wide modifier (aura) created by a card effect. Statuses
 * live on GameState (not on a player) because some — Gorgon's Eye — affect
 * both players at once. Scope fields are optional; an unset field means
 * "unrestricted" along that axis.
 */
export interface StatusEffect {
  /** Unique per game ("status-1", "status-2", ...). */
  id: string;
  code: StatusCode;
  /** The player whose card created the status. */
  controller: PlayerId;
  /** The player the status constrains, if player-scoped. */
  affectedPlayer?: PlayerId;
  /** The Warrior the status is attached to, if Warrior-scoped. */
  affectedInstanceId?: string;
  /** Only Warriors of this faction are covered, if set. */
  faction?: string;
  expiry: StatusExpiry;
  /** Free-form per-status data (e.g. the source card's effectParams). */
  metadata?: Record<string, unknown>;
}

/**
 * GILs Unit (TEMPORARY_OUT_OF_PLAY_RESTORE): a Warrior held off the field
 * for a few of the controller's turns, then returned at full HEALTH. The
 * Warrior keeps its identity (instanceId, card, attached Weapon) while away.
 */
export interface OutOfPlayWarrior {
  warrior: WarriorInPlay;
  /** Controller start-of-turn boundaries left before it returns to the field. */
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
  /** Warriors temporarily removed from play, awaiting their timed return. */
  outOfPlay: OutOfPlayWarrior[];
}

export interface GameState {
  config: RulesConfig;
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  winner: PlayerId | null;
  /** Active temporary statuses/auras, game-wide (see StatusEffect). */
  statuses: StatusEffect[];
  /** Append-only structured log (the Python engine's print-based log). */
  events: GameEvent[];
  /**
   * Serialized mulberry32 state for in-game randomness (e.g. Decimation's
   * stone draw). Advanced by random effects via nextRandom/shuffleWithState
   * so outcomes stay reproducible from the game's seed. Kept independent of
   * the opening shuffle's stream.
   */
  rngState: number;
  /** Counter for unique WarriorInPlay instance ids. */
  nextInstanceId: number;
  /** Counter for unique StatusEffect ids. */
  nextStatusId: number;
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
      /** Card id in the opponent's hand (e.g. the steal target). */
      targetOpponentHandCardId?: string;
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
