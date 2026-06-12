/**
 * Turn lifecycle internals. These functions mutate the state they are given;
 * applyAction clones before calling them so the public API stays pure.
 */
import type { Card } from "@euphoria/card-data";
import type { GameState, PlayerId, PlayerState, WarriorInPlay } from "./types";

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
    exhausted: false,
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
  owner.field.splice(index, 1);

  owner.outDeck.push(warrior.card);
  state.events.push({
    type: "warriorDestroyed",
    player: ownerId,
    instanceId,
    cardId: warrior.card.id,
  });
  if (warrior.attachedWeapon !== undefined) {
    owner.outDeck.push(warrior.attachedWeapon);
    state.events.push({
      type: "weaponDestroyed",
      player: ownerId,
      cardId: warrior.attachedWeapon.id,
      warriorInstanceId: instanceId,
    });
  }
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
  for (const warrior of player.field) {
    warrior.exhausted = false;
  }
  state.events.push({ type: "warriorsRefreshed", player: player.id });

  expireTemporaryBuffs(state, player);
  resolveDelayedEffects(state, player);

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
  // Destroyed/win checks land here with combat (plan steps 5-6).

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
    for (const buff of warrior.temporaryAttackBuffs) {
      warrior.currentAttack -= buff.amount;
      state.events.push({
        type: "buffExpired",
        player: player.id,
        warriorInstanceId: warrior.instanceId,
        amount: buff.amount,
      });
    }
    warrior.temporaryAttackBuffs = [];
  }
}

function resolveDelayedEffects(state: GameState, player: PlayerState): void {
  const remaining: PlayerState["delayedEffects"] = [];
  for (const effect of player.delayedEffects) {
    const turnsRemaining = effect.turnsRemaining - 1;
    if (turnsRemaining <= 0) {
      gainSpirit(state, player, effect.amount);
    } else {
      remaining.push({ ...effect, turnsRemaining });
    }
  }
  player.delayedEffects = remaining;
}
