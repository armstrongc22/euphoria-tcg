import { runEndPhase } from "./turn";
import type { GameAction, GameState, WarriorInPlay } from "./types";

export type EngineErrorCode =
  | "WRONG_PHASE"
  | "GAME_OVER"
  | "NOT_IMPLEMENTED"
  | "CARD_NOT_IN_HAND"
  | "WRONG_CARD_TYPE"
  | "INSUFFICIENT_SPIRIT"
  | "FIELD_FULL"
  | "WARRIOR_NOT_FOUND"
  | "WEAPON_ALREADY_EQUIPPED";

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
        `Action "${action.kind}" is not implemented yet (combat arrives in a later step).`,
      );
  }
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
  if (state.phase === "main" || state.phase === "battle") {
    actions.push({ kind: "endTurn" });
  }
  return actions;
}
