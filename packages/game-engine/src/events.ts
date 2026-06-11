import type { Phase, PlayerId } from "./types";

export type GameEvent =
  | { type: "startingHandDrawn"; player: PlayerId; count: number }
  | { type: "turnStarted"; player: PlayerId; turn: number }
  | { type: "warriorsRefreshed"; player: PlayerId }
  | { type: "buffExpired"; player: PlayerId; warriorInstanceId: string; amount: number }
  | { type: "spiritGained"; player: PlayerId; amount: number; total: number }
  | { type: "cardDrawn"; player: PlayerId; cardId: string }
  /** Deck-out is not a loss for now — flagged as a rule to revisit. */
  | { type: "drawFailedDeckEmpty"; player: PlayerId }
  | { type: "phaseChanged"; phase: Phase }
  | { type: "turnEnded"; player: PlayerId }
  | { type: "warriorSummoned"; player: PlayerId; cardId: string; instanceId: string; cost: number }
  | { type: "itemPlayed"; player: PlayerId; cardId: string; cost: number }
  | { type: "weaponEquipped"; player: PlayerId; cardId: string; warriorInstanceId: string; cost: number }
  /** The card resolved with no effect — it needs a coded handler later. */
  | { type: "effectNotImplemented"; player: PlayerId; cardId: string };
