import type { Phase, PlayerId } from "./types";

export type GameEvent =
  | { type: "startingHandDrawn"; player: PlayerId; count: number }
  | { type: "turnStarted"; player: PlayerId; turn: number }
  | { type: "warriorsRefreshed"; player: PlayerId }
  | { type: "buffExpired"; player: PlayerId; warriorInstanceId: string; amount: number }
  | { type: "spiritGained"; player: PlayerId; amount: number; total: number }
  /** Spirit set by an effect; amount is the delta and may be negative. */
  | { type: "spiritChanged"; player: PlayerId; amount: number; total: number }
  | { type: "cardDrawn"; player: PlayerId; cardId: string }
  /** Deck-out is not a loss for now — flagged as a rule to revisit. */
  | { type: "drawFailedDeckEmpty"; player: PlayerId }
  | { type: "phaseChanged"; phase: Phase }
  | { type: "turnEnded"; player: PlayerId }
  | { type: "warriorSummoned"; player: PlayerId; cardId: string; instanceId: string; cost: number }
  | { type: "warriorRevived"; player: PlayerId; cardId: string; instanceId: string }
  | { type: "extraAttackGranted"; player: PlayerId; instanceId: string; amount: number; attacksRemaining: number }
  | { type: "deckSearched"; player: PlayerId; cardId: string }
  | { type: "itemPlayed"; player: PlayerId; cardId: string; cost: number }
  | { type: "weaponEquipped"; player: PlayerId; cardId: string; warriorInstanceId: string; cost: number }
  /** The card resolved with no effect — it needs a coded handler later. */
  | { type: "effectNotImplemented"; player: PlayerId; cardId: string }
  /** Cost paid and card moved to the Out Deck; its effect is still pending a handler. */
  | { type: "attackCardUsed"; player: PlayerId; cardId: string; attackerInstanceId: string; cost: number }
  | { type: "warriorAttacked"; player: PlayerId; attackerInstanceId: string; defenderInstanceId: string; damage: number }
  /** player = the destroyed Warrior's owner. */
  | { type: "warriorDestroyed"; player: PlayerId; instanceId: string; cardId: string }
  | { type: "weaponDestroyed"; player: PlayerId; cardId: string; warriorInstanceId: string }
  | { type: "directAttacked"; player: PlayerId; attackerInstanceId: string; livesRemaining: number }
  | { type: "gameWon"; winner: PlayerId }
  | { type: "effectResolved"; player: PlayerId; cardId: string; effectCode: string }
  | { type: "warriorAttackModified"; player: PlayerId; instanceId: string; amount: number; newAttack: number }
  | { type: "warriorHealthModified"; player: PlayerId; instanceId: string; amount: number; newHealth: number };
