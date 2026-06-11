import { opponentOf, runEndPhase } from "./turn";
import type { GameAction, GameState, PlayerId, WarriorInPlay } from "./types";

export type EngineErrorCode =
  | "WRONG_PHASE"
  | "GAME_OVER"
  | "NOT_IMPLEMENTED"
  | "CARD_NOT_IN_HAND"
  | "WRONG_CARD_TYPE"
  | "INSUFFICIENT_SPIRIT"
  | "FIELD_FULL"
  | "WARRIOR_NOT_FOUND"
  | "WEAPON_ALREADY_EQUIPPED"
  | "FIRST_TURN_NO_ATTACKS"
  | "WARRIOR_EXHAUSTED"
  | "OPPONENT_HAS_WARRIORS"
  | "DIRECT_ATTACK_LIMIT";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineError };

function fail(code: EngineErrorCode, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * Pure action reducer: validates, then returns a new state (the input state
 * is never mutated). Illegal actions return a typed error instead of throwing.
 */
export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.winner !== null) {
    return fail("GAME_OVER", `The game is over; ${state.winner} won.`);
  }

  switch (action.kind) {
    case "playWarrior":
      return playWarrior(state, action.cardId);
    case "playItem":
      return playItem(state, action.cardId);
    case "equipWeapon":
      return equipWeapon(state, action.cardId, action.warriorInstanceId);
    case "attack":
      return attackWarrior(state, action);
    case "directAttack":
      return directAttack(state, action.attackerInstanceId);

    case "enterBattle": {
      if (state.phase !== "main") {
        return fail(
          "WRONG_PHASE",
          `Battle Phase can only be entered from Main Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      next.phase = "battle";
      next.events.push({ type: "phaseChanged", phase: "battle" });
      return { ok: true, state: next };
    }

    case "endTurn": {
      if (state.phase !== "main" && state.phase !== "battle") {
        return fail(
          "WRONG_PHASE",
          `The turn can only be ended from Main or Battle Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      runEndPhase(next);
      return { ok: true, state: next };
    }

    default:
      return fail(
        "NOT_IMPLEMENTED",
        `Action "${(action as GameAction).kind}" is not implemented yet.`,
      );
  }
}

/** Shared gates for declaring any attack with one of your Warriors. */
function validateAttacker(
  state: GameState,
  attackerInstanceId: string,
): { attacker: WarriorInPlay } | { error: ActionResult } {
  if (state.phase !== "battle") {
    return {
      error: fail(
        "WRONG_PHASE",
        `Attacks can only be declared in Battle Phase (current: ${state.phase}).`,
      ),
    };
  }
  if (state.config.noAttacksOnFirstTurn && state.turn === 1) {
    return {
      error: fail(
        "FIRST_TURN_NO_ATTACKS",
        "No attacks are allowed on the first turn of the game.",
      ),
    };
  }
  const attacker = state.players[state.activePlayer].field.find(
    (w) => w.instanceId === attackerInstanceId,
  );
  if (attacker === undefined) {
    return {
      error: fail(
        "WARRIOR_NOT_FOUND",
        `${state.activePlayer} controls no Warrior "${attackerInstanceId}".`,
      ),
    };
  }
  if (attacker.exhausted) {
    return {
      error: fail(
        "WARRIOR_EXHAUSTED",
        `${attacker.card.name} has already attacked this turn.`,
      ),
    };
  }
  return { attacker };
}

/** Removes a Warrior from the field; it and any attached Weapon go to the Out Deck. */
function destroyWarrior(
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

function attackWarrior(
  state: GameState,
  action: Extract<GameAction, { kind: "attack" }>,
): ActionResult {
  if (action.attackCardIds !== undefined && action.attackCardIds.length > 0) {
    return fail("NOT_IMPLEMENTED", "Attack cards are not implemented yet.");
  }
  const gate = validateAttacker(state, action.attackerInstanceId);
  if ("error" in gate) return gate.error;

  const opponentId = opponentOf(state.activePlayer);
  const defenderExists = state.players[opponentId].field.some(
    (w) => w.instanceId === action.defenderInstanceId,
  );
  if (!defenderExists) {
    return fail(
      "WARRIOR_NOT_FOUND",
      `${opponentId} controls no Warrior "${action.defenderInstanceId}" to attack.`,
    );
  }

  const next = structuredClone(state);
  const attacker = next.players[next.activePlayer].field.find(
    (w) => w.instanceId === action.attackerInstanceId,
  )!;
  const defender = next.players[opponentId].field.find(
    (w) => w.instanceId === action.defenderInstanceId,
  )!;

  // The attacker takes no counter damage (CLAUDE.md overrides the spec's
  // "simultaneous" wording; see RulesConfig.combatDamageSimultaneous).
  const damage = attacker.currentAttack;
  defender.currentHealth -= damage;
  attacker.exhausted = true;
  next.events.push({
    type: "warriorAttacked",
    player: next.activePlayer,
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
    damage,
  });

  if (defender.currentHealth <= 0) {
    destroyWarrior(next, opponentId, defender.instanceId);
  }
  return { ok: true, state: next };
}

function directAttack(state: GameState, attackerInstanceId: string): ActionResult {
  const gate = validateAttacker(state, attackerInstanceId);
  if ("error" in gate) return gate.error;

  const opponentId = opponentOf(state.activePlayer);
  if (state.players[opponentId].field.length > 0) {
    return fail(
      "OPPONENT_HAS_WARRIORS",
      "Direct attacks are only allowed when the opponent controls no Warriors.",
    );
  }
  if (state.players[state.activePlayer].directAttackUsedThisTurn) {
    return fail(
      "DIRECT_ATTACK_LIMIT",
      `Only ${state.config.directAttackLimitPerTurn} direct attack is allowed per turn.`,
    );
  }

  const next = structuredClone(state);
  const player = next.players[next.activePlayer];
  const opponent = next.players[opponentId];
  const attacker = player.field.find((w) => w.instanceId === attackerInstanceId)!;

  attacker.exhausted = true;
  player.directAttackUsedThisTurn = true;
  opponent.lives -= 1;
  next.events.push({
    type: "directAttacked",
    player: player.id,
    attackerInstanceId,
    livesRemaining: opponent.lives,
  });

  if (opponent.lives <= 0) {
    next.winner = player.id;
    next.events.push({ type: "gameWon", winner: player.id });
  }
  return { ok: true, state: next };
}

/**
 * Shared validation for playing a card from the active player's hand during
 * Main Phase. Returns the hand index on success.
 */
function validateMainPhasePlay(
  state: GameState,
  cardId: string,
  expectedType: "Warrior" | "Item" | "Weapon",
  verb: string,
): { handIndex: number } | { error: ActionResult } {
  if (state.phase !== "main") {
    return {
      error: fail(
        "WRONG_PHASE",
        `${expectedType}s can only be ${verb} in Main Phase (current: ${state.phase}).`,
      ),
    };
  }
  const player = state.players[state.activePlayer];
  const handIndex = player.hand.findIndex((c) => c.id === cardId);
  if (handIndex === -1) {
    return {
      error: fail(
        "CARD_NOT_IN_HAND",
        `${state.activePlayer} has no card "${cardId}" in hand.`,
      ),
    };
  }
  const card = player.hand[handIndex]!;
  if (card.type !== expectedType) {
    return {
      error: fail("WRONG_CARD_TYPE", `${card.name} is not a ${expectedType}.`),
    };
  }
  if (player.spirit < card.cost) {
    return {
      error: fail(
        "INSUFFICIENT_SPIRIT",
        `${card.name} costs ${card.cost} Spirit; ${player.id} has ${player.spirit}.`,
      ),
    };
  }
  return { handIndex };
}

function playWarrior(state: GameState, cardId: string): ActionResult {
  const validated = validateMainPhasePlay(state, cardId, "Warrior", "summoned");
  if ("error" in validated) return validated.error;

  const player = state.players[state.activePlayer];
  if (player.field.length >= state.config.warriorSlots) {
    return fail(
      "FIELD_FULL",
      `The Warrior field is full (${state.config.warriorSlots} slots).`,
    );
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);

  const instanceId = `warrior-${next.nextInstanceId}`;
  next.nextInstanceId += 1;
  const warrior: WarriorInPlay = {
    instanceId,
    card,
    currentAttack: card.attack ?? 0,
    currentHealth: card.health ?? 0,
    maxHealth: card.health ?? 0,
    exhausted: false,
    temporaryAttackBuffs: [],
  };
  nextPlayer.field.push(warrior);

  next.events.push({
    type: "warriorSummoned",
    player: nextPlayer.id,
    cardId: card.id,
    instanceId,
    cost: card.cost,
  });
  return { ok: true, state: next };
}

function playItem(state: GameState, cardId: string): ActionResult {
  const validated = validateMainPhasePlay(state, cardId, "Item", "played");
  if ("error" in validated) return validated.error;

  const next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);
  nextPlayer.outDeck.push(card);

  next.events.push({
    type: "itemPlayed",
    player: nextPlayer.id,
    cardId: card.id,
    cost: card.cost,
  });
  // Effect registry lands in a later step; per project decision, uncoded
  // cards still resolve (Spirit spent) and are marked for handlers later.
  next.events.push({
    type: "effectNotImplemented",
    player: nextPlayer.id,
    cardId: card.id,
  });
  return { ok: true, state: next };
}

function equipWeapon(
  state: GameState,
  cardId: string,
  warriorInstanceId: string,
): ActionResult {
  const validated = validateMainPhasePlay(state, cardId, "Weapon", "equipped");
  if ("error" in validated) return validated.error;

  const player = state.players[state.activePlayer];
  const warrior = player.field.find((w) => w.instanceId === warriorInstanceId);
  if (warrior === undefined) {
    return fail(
      "WARRIOR_NOT_FOUND",
      `${player.id} controls no Warrior "${warriorInstanceId}". Weapons can only be equipped to your own Warriors.`,
    );
  }
  if (state.config.oneWeaponPerWarrior && warrior.attachedWeapon !== undefined) {
    return fail(
      "WEAPON_ALREADY_EQUIPPED",
      `${warrior.card.name} already has a Weapon. Weapons cannot be replaced or moved.`,
    );
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;
  const nextWarrior = nextPlayer.field.find(
    (w) => w.instanceId === warriorInstanceId,
  )!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);
  nextWarrior.attachedWeapon = card;

  next.events.push({
    type: "weaponEquipped",
    player: nextPlayer.id,
    cardId: card.id,
    warriorInstanceId,
    cost: card.cost,
  });
  // Weapon passive effects (e.g. Xiwanghao) need coded handlers later.
  next.events.push({
    type: "effectNotImplemented",
    player: nextPlayer.id,
    cardId: card.id,
  });
  return { ok: true, state: next };
}

/** Enumerates the currently legal (implemented) actions. */
export function getLegalActions(state: GameState): GameAction[] {
  if (state.winner !== null) return [];

  const actions: GameAction[] = [];
  if (state.phase === "main") {
    const player = state.players[state.activePlayer];
    const seen = new Set<string>();
    for (const card of player.hand) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      if (card.cost > player.spirit) continue;

      if (card.type === "Warrior") {
        if (player.field.length < state.config.warriorSlots) {
          actions.push({ kind: "playWarrior", cardId: card.id });
        }
      } else if (card.type === "Item") {
        actions.push({ kind: "playItem", cardId: card.id });
      } else if (card.type === "Weapon") {
        for (const warrior of player.field) {
          if (state.config.oneWeaponPerWarrior && warrior.attachedWeapon) {
            continue;
          }
          actions.push({
            kind: "equipWeapon",
            cardId: card.id,
            warriorInstanceId: warrior.instanceId,
          });
        }
      }
    }
    actions.push({ kind: "enterBattle" });
  }
  if (state.phase === "battle") {
    const player = state.players[state.activePlayer];
    const opponent = state.players[opponentOf(state.activePlayer)];
    const attacksAllowed = !(
      state.config.noAttacksOnFirstTurn && state.turn === 1
    );
    if (attacksAllowed) {
      for (const attacker of player.field) {
        if (attacker.exhausted) continue;
        for (const defender of opponent.field) {
          actions.push({
            kind: "attack",
            attackerInstanceId: attacker.instanceId,
            defenderInstanceId: defender.instanceId,
          });
        }
        if (opponent.field.length === 0 && !player.directAttackUsedThisTurn) {
          actions.push({
            kind: "directAttack",
            attackerInstanceId: attacker.instanceId,
          });
        }
      }
    }
  }
  if (state.phase === "main" || state.phase === "battle") {
    actions.push({ kind: "endTurn" });
  }
  return actions;
}
