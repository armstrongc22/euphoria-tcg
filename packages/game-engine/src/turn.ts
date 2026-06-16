/**
 * Turn lifecycle internals. These functions mutate the state they are given;
 * applyAction clones before calling them so the public API stays pure.
 */
import type { Card } from "@euphoria/card-data";
import {
  destructionPreventionPenalty,
  expireStatuses,
  findDestructionProtection,
  removeDuelsForWarrior,
  triggerExpiredStatuses,
} from "./status";
import type {
  DelayedEffect,
  GameState,
  PlayerId,
  PlayerState,
  TemporaryAttackBuff,
  WarriorInPlay,
} from "./types";

export function opponentOf(player: PlayerId): PlayerId {
  return player === "player1" ? "player2" : "player1";
}

export function gainSpirit(
  state: GameState,
  player: PlayerState,
  amount: number,
): void {
  if (amount <= 0) return;
  const cap = state.config.maxSpirit;
  player.spirit =
    cap === null ? player.spirit + amount : Math.min(cap, player.spirit + amount);
  state.events.push({
    type: "spiritGained",
    player: player.id,
    amount,
    total: player.spirit,
  });
}

export function drawCards(
  state: GameState,
  player: PlayerState,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const card = player.deck.shift();
    if (card === undefined) {
      // Deck-out is not a loss for now — flagged as a rule to revisit.
      state.events.push({ type: "drawFailedDeckEmpty", player: player.id });
      return;
    }
    player.hand.push(card);
    state.events.push({ type: "cardDrawn", player: player.id, cardId: card.id });
  }
}

/** Builds a fresh WarriorInPlay at full stats with a unique instance id. */
export function createWarriorInPlay(state: GameState, card: Card): WarriorInPlay {
  const instanceId = `warrior-${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return {
    instanceId,
    card,
    currentAttack: card.attack ?? 0,
    currentHealth: card.health ?? 0,
    maxHealth: card.health ?? 0,
    attacksRemaining: 1,
    temporaryAttackBuffs: [],
  };
}

/** Removes a Warrior from the field; it and any attached Weapon go to the Out Deck. */
export function destroyWarrior(
  state: GameState,
  ownerId: PlayerId,
  instanceId: string,
): void {
  const owner = state.players[ownerId];
  const index = owner.field.findIndex((w) => w.instanceId === instanceId);
  if (index === -1) return;
  const warrior = owner.field[index]!;

  // High Tea: a protected Warrior survives any destruction this turn. The
  // prevented destruction costs it the status's penalty instead, floored
  // at 1 — the protection is absolute, so the penalty (or the lethal
  // damage that brought us here) can never finish the job.
  const protection = findDestructionProtection(state, instanceId);
  if (protection !== undefined) {
    warrior.currentHealth = Math.max(
      1,
      warrior.currentHealth - destructionPreventionPenalty(protection),
    );
    state.events.push({
      type: "destructionPrevented",
      player: ownerId,
      instanceId,
      statusId: protection.id,
      newHealth: warrior.currentHealth,
    });
    return;
  }
  // XL-QR517: a destroyed tank doesn't die — it spits the original Warrior
  // back out at its stashed stats, keeping its place (and Weapon) on the
  // field. Resolved after destruction protection: a protected tank is never
  // destroyed in the first place, so it never reaches this point.
  if (warrior.tankForm !== undefined) {
    const { originalAttack, originalHealth, originalMaxHealth } = warrior.tankForm;
    warrior.currentAttack = originalAttack;
    warrior.currentHealth = originalHealth;
    warrior.maxHealth = originalMaxHealth;
    warrior.tankForm = undefined;
    state.events.push({
      type: "warriorReturnedFromTank",
      player: ownerId,
      instanceId,
      cardId: warrior.card.id,
      newHealth: warrior.currentHealth,
    });
    return;
  }

  owner.field.splice(index, 1);

  // Coerced Loyalty: a stolen Warrior's card belongs to its original owner,
  // so it (and any Weapon) return to that player's Out Deck, not the thief's.
  const cardOwner = state.players[warrior.stolenFrom ?? ownerId];
  cardOwner.outDeck.push(warrior.card);
  state.events.push({
    type: "warriorDestroyed",
    player: ownerId,
    instanceId,
    cardId: warrior.card.id,
  });
  if (warrior.attachedWeapon !== undefined) {
    cardOwner.outDeck.push(warrior.attachedWeapon);
    state.events.push({
      type: "weaponDestroyed",
      player: ownerId,
      cardId: warrior.attachedWeapon.id,
      warriorInstanceId: instanceId,
    });
  }
  // Trial of Gia: a duel ends once one of its Warriors is destroyed.
  removeDuelsForWarrior(state, instanceId);
}

/**
 * Full Start Phase for the active player, ending in Main. Order ported from
 * the Python engine's start_turn: refresh -> expire buffs -> delayed effects
 * -> gain Spirit -> draw (Spirit always before draw, per the spec).
 */
export function runStartPhase(state: GameState): void {
  const player = state.players[state.activePlayer];
  state.phase = "start";
  state.events.push({ type: "turnStarted", player: player.id, turn: state.turn });

  player.directAttackUsedThisTurn = false;
  player.warriorSummonsUsedThisTurn = 0;
  for (const warrior of player.field) {
    warrior.attacksRemaining = 1;
  }
  state.events.push({ type: "warriorsRefreshed", player: player.id });

  expireTemporaryBuffs(state, player);
  triggerExpiredStatuses(state, expireStatuses(state, player.id, "startOfTurn"));
  resolveDelayedEffects(state, player);
  resolveOutOfPlayReturns(state, player);

  gainSpirit(state, player, state.config.spiritGainPerTurn);
  drawCards(state, player, 1);

  state.phase = "main";
  state.events.push({ type: "phaseChanged", phase: "main" });
}

/** End Phase, then hand the turn to the opponent and run their Start Phase. */
export function runEndPhase(state: GameState): void {
  const player = state.players[state.activePlayer];
  state.phase = "end";
  state.events.push({ type: "turnEnded", player: player.id });

  // Unused extra attacks (e.g. EXTRA_ATTACK_THIS_TURN) expire at end of turn.
  for (const warrior of player.field) {
    warrior.attacksRemaining = Math.min(warrior.attacksRemaining, 1);
  }
  triggerExpiredStatuses(state, expireStatuses(state, player.id, "endOfTurn"));

  state.activePlayer = opponentOf(state.activePlayer);
  state.turn += 1;
  runStartPhase(state);
}

/**
 * Temporary attack buffs expire at the start of the owner's next turn,
 * matching the Python engine (the spec's "End Phase" wording was overruled
 * by project decision since CLAUDE.md is silent on expiry timing).
 */
function expireTemporaryBuffs(state: GameState, player: PlayerState): void {
  for (const warrior of player.field) {
    const remaining: TemporaryAttackBuff[] = [];
    for (const buff of warrior.temporaryAttackBuffs) {
      const turnsRemaining = (buff.turnsRemaining ?? 1) - 1;
      if (turnsRemaining > 0) {
        remaining.push({ amount: buff.amount, turnsRemaining });
        continue;
      }
      warrior.currentAttack -= buff.amount;
      state.events.push({
        type: "buffExpired",
        player: player.id,
        warriorInstanceId: warrior.instanceId,
        amount: buff.amount,
      });
    }
    warrior.temporaryAttackBuffs = remaining;
  }
}

function resolveDelayedEffects(state: GameState, player: PlayerState): void {
  const remaining: PlayerState["delayedEffects"] = [];
  for (const effect of player.delayedEffects) {
    // Silurian Period: recurring — fire this tick, then keep it until the
    // scheduled ticks run out.
    if (effect.type === "lingeringDamage") {
      applyLingeringDamage(state, effect);
      const turnsRemaining = effect.turnsRemaining - 1;
      if (turnsRemaining > 0) remaining.push({ ...effect, turnsRemaining });
      continue;
    }
    // Secure Deposits: one-shot — resolve when the countdown reaches 0.
    const turnsRemaining = effect.turnsRemaining - 1;
    if (turnsRemaining <= 0) {
      gainSpirit(state, player, effect.amount);
    } else {
      remaining.push({ ...effect, turnsRemaining });
    }
  }
  player.delayedEffects = remaining;
}

/**
 * GILs Unit (TEMPORARY_OUT_OF_PLAY_RESTORE): each controller Start Phase
 * counts a held Warrior down by one boundary. When its countdown reaches 0
 * the Warrior returns to the field at full HEALTH, keeping its identity and
 * attached Weapon, with a fresh attack available this turn.
 */
function resolveOutOfPlayReturns(state: GameState, player: PlayerState): void {
  const remaining: PlayerState["outOfPlay"] = [];
  for (const held of player.outOfPlay) {
    const turnsRemaining = held.turnsRemaining - 1;
    if (turnsRemaining > 0) {
      remaining.push({ ...held, turnsRemaining });
      continue;
    }
    const warrior = held.warrior;
    warrior.currentHealth = warrior.maxHealth;
    warrior.attacksRemaining = 1;
    player.field.push(warrior);
    state.events.push({
      type: "warriorReturnedFromOutOfPlay",
      player: player.id,
      instanceId: warrior.instanceId,
      cardId: warrior.card.id,
      newHealth: warrior.currentHealth,
    });
  }
  player.outOfPlay = remaining;
}

/**
 * One tick of Silurian Period's lingering damage: each snapshot Warrior
 * still on `targetPlayer`'s field takes `amount`. A Warrior that already
 * left the field is skipped (no crash), and a lethal tick sends the Warrior
 * and its attached Weapon to the Out Deck via destroyWarrior.
 */
function applyLingeringDamage(
  state: GameState,
  effect: Extract<DelayedEffect, { type: "lingeringDamage" }>,
): void {
  for (const instanceId of effect.targetInstanceIds) {
    const target = state.players[effect.targetPlayer].field.find(
      (w) => w.instanceId === instanceId,
    );
    if (target === undefined) continue;
    target.currentHealth -= effect.amount;
    state.events.push({
      type: "warriorHealthModified",
      player: effect.targetPlayer,
      instanceId,
      amount: -effect.amount,
      newHealth: target.currentHealth,
    });
    if (target.currentHealth <= 0) {
      destroyWarrior(state, effect.targetPlayer, instanceId);
    }
  }
}
