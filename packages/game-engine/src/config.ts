import type { RulesConfig } from "./types";

export const DEFAULT_RULES: RulesConfig = {
  deckSize: 30,
  startingHandSize: 5,
  startingSpirit: 1,
  spiritGainPerTurn: 1,
  maxSpirit: null,
  startingLives: 3,
  warriorSlots: 5,
  noAttacksOnFirstTurn: true,
  directAttackLimitPerTurn: 1,
  warriorSummonsPerTurn: 1,
  warriorsCanAttackTurnSummoned: true,
  combatDamageSimultaneous: false,
  attackCardsOnDirectAttacks: false,
  oneWeaponPerWarrior: true,
};
