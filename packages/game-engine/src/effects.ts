/**
 * Effect registry: resolves card effects by effectCode/effectParams from
 * card data. Handlers mutate a draft state that EffectRegistry.resolve
 * clones internally, so a handler that fails or throws can never corrupt
 * the caller's state — the untouched input state is returned instead.
 */
import type { Card } from "@euphoria/card-data";
import { otherWarriors } from "./splash";
import { addStatus, addWarriorAttackDisable } from "./status";
import {
  createWarriorInPlay,
  destroyWarrior,
  drawCards,
  gainSpirit,
  opponentOf,
} from "./turn";
import type { GameState, PlayerId, WarriorInPlay } from "./types";

export type EffectParams = Readonly<Record<string, unknown>>;

export interface EffectContext {
  /** The effect's controller. */
  player: PlayerId;
  /** Set when the effect is used during an attack. */
  attackerInstanceId?: string;
  defenderInstanceId?: string;
  /** Explicit target chosen by the player, if any. */
  targetInstanceId?: string;
  /** Chosen card in the controller's own Out Deck (e.g. revive target). */
  targetOutDeckCardId?: string;
  /** Chosen card in the controller's own deck (e.g. search target). */
  targetDeckCardId?: string;
  /** Chosen card in the opponent's hand (e.g. steal target). */
  targetOpponentHandCardId?: string;
}

export type EffectOutcome =
  | { resolved: true }
  | {
      resolved: false;
      code: "EFFECT_NOT_IMPLEMENTED" | "EFFECT_FAILED";
      reason: string;
    };

export interface EffectResolution {
  outcome: EffectOutcome;
  /** The post-effect state on success; the untouched input state otherwise. */
  state: GameState;
}

export type EffectHandler = (
  state: GameState,
  params: EffectParams,
  context: EffectContext,
) => EffectOutcome;

/** "gainSpirit", "gain-spirit", and "GAIN_SPIRIT" all normalize the same. */
export function normalizeEffectCode(code: string): string {
  return code
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

export class EffectRegistry {
  private readonly handlers = new Map<string, EffectHandler>();

  register(code: string, handler: EffectHandler): void {
    this.handlers.set(normalizeEffectCode(code), handler);
  }

  has(code: string): boolean {
    return this.handlers.has(normalizeEffectCode(code));
  }

  resolve(state: GameState, card: Card, context: EffectContext): EffectResolution {
    const code = card.effectCode?.trim();
    if (code === undefined || code === "") {
      return {
        outcome: {
          resolved: false,
          code: "EFFECT_NOT_IMPLEMENTED",
          reason: `${card.name} has no effectCode.`,
        },
        state,
      };
    }
    const handler = this.handlers.get(normalizeEffectCode(code));
    if (handler === undefined) {
      return {
        outcome: {
          resolved: false,
          code: "EFFECT_NOT_IMPLEMENTED",
          reason: `No handler registered for effect "${code}" (${card.name}).`,
        },
        state,
      };
    }

    const draft = structuredClone(state);
    try {
      const outcome = handler(draft, card.effectParams ?? {}, context);
      if (!outcome.resolved) {
        return { outcome, state };
      }
      draft.events.push({
        type: "effectResolved",
        player: context.player,
        cardId: card.id,
        effectCode: normalizeEffectCode(code),
      });
      return { outcome, state: draft };
    } catch (error) {
      return {
        outcome: {
          resolved: false,
          code: "EFFECT_FAILED",
          reason: `Effect "${code}" threw: ${error instanceof Error ? error.message : String(error)}`,
        },
        state,
      };
    }
  }
}

function numberParam(
  params: EffectParams,
  keys: readonly string[],
  fallback: number,
): number {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return fallback;
}

function findWarrior(
  state: GameState,
  instanceId: string,
): { warrior: WarriorInPlay; owner: PlayerId } | undefined {
  for (const owner of ["player1", "player2"] as const) {
    const warrior = state.players[owner].field.find(
      (w) => w.instanceId === instanceId,
    );
    if (warrior !== undefined) return { warrior, owner };
  }
  return undefined;
}

/**
 * Picks the effect's target: an explicit params.target of "attacker"/"self"
 * or "defender" wins, then the context's chosen target, then the default.
 */
function resolveTargetInstanceId(
  params: EffectParams,
  context: EffectContext,
  fallback: string | undefined,
): string | undefined {
  const target =
    typeof params["target"] === "string"
      ? normalizeEffectCode(params["target"])
      : "";
  if (target === "ATTACKER" || target === "SELF") return context.attackerInstanceId;
  if (target === "DEFENDER") return context.defenderInstanceId;
  return context.targetInstanceId ?? fallback;
}

function targetFailure(reason: string): EffectOutcome {
  return { resolved: false, code: "EFFECT_FAILED", reason };
}

/** Which side of the field an effect may target, relative to its controller. */
export type TargetSide = "friendly" | "enemy" | "any";

type TargetResult =
  | { ok: true; warrior: WarriorInPlay; owner: PlayerId }
  | { ok: false; outcome: EffectOutcome };

/**
 * Shared target resolution for effects that need a Warrior on the field:
 * picks the instance id (params.target keyword > context target > fallback),
 * then validates existence and side. Out-Deck targets (revive) will get a
 * sibling helper when they land.
 */
function requireWarriorTarget(
  state: GameState,
  params: EffectParams,
  context: EffectContext,
  side: TargetSide,
  fallbackId?: string,
): TargetResult {
  const targetId = resolveTargetInstanceId(params, context, fallbackId);
  if (targetId === undefined) {
    return {
      ok: false,
      outcome: targetFailure("a target Warrior is required (targetInstanceId missing)."),
    };
  }
  const found = findWarrior(state, targetId);
  if (found === undefined) {
    return {
      ok: false,
      outcome: targetFailure(`No Warrior "${targetId}" on the field.`),
    };
  }
  if (side === "friendly" && found.owner !== context.player) {
    return {
      ok: false,
      outcome: targetFailure("the target must be a friendly Warrior."),
    };
  }
  if (side === "enemy" && found.owner === context.player) {
    return {
      ok: false,
      outcome: targetFailure("the target must be an enemy Warrior."),
    };
  }
  return { ok: true, warrior: found.warrior, owner: found.owner };
}

const TEMPORARY_DURATIONS = new Set([
  "THIS_TURN",
  "TURN",
  "END_OF_TURN",
  "THIS_ATTACK",
  "WHEN_ATTACKING",
  "NEXT_ATTACK",
]);

function stringParam(
  params: EffectParams,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function stringArrayParam(
  params: EffectParams,
  key: string,
): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

/** Health change with the shared rules: overheal raises max, <= 0 destroys. */
function modifyWarriorHealth(
  state: GameState,
  owner: PlayerId,
  warrior: WarriorInPlay,
  amount: number,
): void {
  warrior.currentHealth += amount;
  warrior.maxHealth = Math.max(warrior.maxHealth, warrior.currentHealth);
  state.events.push({
    type: "warriorHealthModified",
    player: owner,
    instanceId: warrior.instanceId,
    amount,
    newHealth: warrior.currentHealth,
  });
  if (warrior.currentHealth <= 0) {
    destroyWarrior(state, owner, warrior.instanceId);
  }
}

function isTemporary(params: EffectParams): boolean {
  return (
    typeof params["duration"] === "string" &&
    TEMPORARY_DURATIONS.has(normalizeEffectCode(params["duration"]))
  );
}

/**
 * Turn count from a duration param: "2_turns" -> 2, "3_turns" -> 3;
 * digit-less durations like "next_turn" (and a missing param) fall back.
 */
function durationTurns(params: EffectParams, fallback: number): number {
  const duration = stringParam(params, ["duration"]);
  if (duration !== undefined) {
    const match = /(\d+)/.exec(duration);
    if (match !== null) return Number(match[1]);
  }
  return fallback;
}

const gainSpiritHandler: EffectHandler = (state, params, context) => {
  const amount = numberParam(params, ["amount"], 1);
  gainSpirit(state, state.players[context.player], amount);
  return { resolved: true };
};

const drawCardsHandler: EffectHandler = (state, params, context) => {
  const amount = numberParam(params, ["amount", "count"], 1);
  drawCards(state, state.players[context.player], amount);
  return { resolved: true };
};

/** Buffs target the attacker by default; duration params make them expire. */
const modifyAttackHandler: EffectHandler = (state, params, context) => {
  const targetId = resolveTargetInstanceId(params, context, context.attackerInstanceId);
  if (targetId === undefined) return targetFailure("modifyAttack needs a target Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  const amount = numberParam(params, ["amount"], 0);
  found.warrior.currentAttack += amount;
  if (isTemporary(params)) {
    found.warrior.temporaryAttackBuffs.push({ amount });
  }
  state.events.push({
    type: "warriorAttackModified",
    player: found.owner,
    instanceId: targetId,
    amount,
    newAttack: found.warrior.currentAttack,
  });
  return { resolved: true };
};

/**
 * Positive amounts heal (overheal raises max health); negative ones harm.
 * Side is unrestricted: the HEAL_TARGET card text says "Choose 1 Warrior".
 */
const modifyHealthHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "any", context.attackerInstanceId);
  if (!target.ok) return target.outcome;

  modifyWarriorHealth(state, target.owner, target.warrior, numberParam(params, ["amount"], 0));
  return { resolved: true };
};

/** Damage targets enemy Warriors only. */
const dealDamageToWarriorHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "enemy", context.defenderInstanceId);
  if (!target.ok) return target.outcome;

  modifyWarriorHealth(state, target.owner, target.warrior, -numberParam(params, ["amount"], 0));
  return { resolved: true };
};

/**
 * Shared selection of a Warrior card from the controller's own Out Deck.
 * Missing choices, ids not in the Out Deck, and non-Warrior cards all fail
 * (and EffectRegistry.resolve discards any partial work on failure).
 */
function requireOutDeckWarrior(
  state: GameState,
  context: EffectContext,
): { ok: true; card: Card; index: number } | { ok: false; outcome: EffectOutcome } {
  const cardId = context.targetOutDeckCardId;
  if (cardId === undefined) {
    return {
      ok: false,
      outcome: targetFailure("an Out Deck card is required (targetOutDeckCardId missing)."),
    };
  }
  const outDeck = state.players[context.player].outDeck;
  const index = outDeck.findIndex((c) => c.id === cardId);
  if (index === -1) {
    return {
      ok: false,
      outcome: targetFailure(`No card "${cardId}" in ${context.player}'s Out Deck.`),
    };
  }
  const card = outDeck[index]!;
  if (card.type !== "Warrior") {
    return {
      ok: false,
      outcome: targetFailure(`${card.name} is not a Warrior and cannot be revived.`),
    };
  }
  return { ok: true, card, index };
}

/** "Revive 1 Warrior that's been destroyed to your side of the field." */
const reviveWarriorHandler: EffectHandler = (state, _params, context) => {
  const player = state.players[context.player];
  if (player.field.length >= state.config.warriorSlots) {
    return targetFailure(
      `the Warrior field is full (${state.config.warriorSlots} slots).`,
    );
  }
  const target = requireOutDeckWarrior(state, context);
  if (!target.ok) return target.outcome;

  player.outDeck.splice(target.index, 1);
  const warrior = createWarriorInPlay(state, target.card);
  player.field.push(warrior);
  state.events.push({
    type: "warriorRevived",
    player: context.player,
    cardId: target.card.id,
    instanceId: warrior.instanceId,
  });
  return { resolved: true };
};

/**
 * Shared selection of a card from the controller's own deck, validated
 * against the effect's search constraints (params.targetTypes and
 * params.targetFaction). Missing choices, ids not in the deck, and
 * constraint mismatches all fail safely.
 */
function requireDeckCard(
  state: GameState,
  params: EffectParams,
  context: EffectContext,
): { ok: true; card: Card; index: number } | { ok: false; outcome: EffectOutcome } {
  const cardId = context.targetDeckCardId;
  if (cardId === undefined) {
    return {
      ok: false,
      outcome: targetFailure("a deck card is required (targetDeckCardId missing)."),
    };
  }
  const deck = state.players[context.player].deck;
  const index = deck.findIndex((c) => c.id === cardId);
  if (index === -1) {
    return {
      ok: false,
      outcome: targetFailure(`No card "${cardId}" in ${context.player}'s deck.`),
    };
  }
  const card = deck[index]!;
  const types = stringArrayParam(params, "targetTypes");
  if (types !== undefined && !types.includes(card.type)) {
    return {
      ok: false,
      outcome: targetFailure(
        `${card.name} is a ${card.type}; this search needs a ${types.join(" or ")} card.`,
      ),
    };
  }
  const faction = stringParam(params, ["targetFaction"]);
  if (faction !== undefined && card.faction !== faction) {
    return {
      ok: false,
      outcome: targetFailure(
        `${card.name} is ${card.faction}; this search needs a ${faction} card.`,
      ),
    };
  }
  return { ok: true, card, index };
}

/** "Add 1 <matching> card from your deck to your hand." No shuffle: neither
 *  the card texts nor effectParams call for one. */
const searchDeckHandler: EffectHandler = (state, params, context) => {
  const target = requireDeckCard(state, params, context);
  if (!target.ok) return target.outcome;

  const player = state.players[context.player];
  player.deck.splice(target.index, 1);
  player.hand.push(target.card);
  state.events.push({
    type: "deckSearched",
    player: context.player,
    cardId: target.card.id,
  });
  return { resolved: true };
};

/**
 * Shared selection of a card from the opponent's hand. A card id that only
 * exists in the controller's own hand is "not in the opponent's hand" and
 * fails. (Revealing the hand is a UI concern; engine state is open.)
 */
function requireOpponentHandCard(
  state: GameState,
  context: EffectContext,
  requiredType?: Card["type"],
): { ok: true; card: Card; index: number } | { ok: false; outcome: EffectOutcome } {
  const cardId = context.targetOpponentHandCardId;
  if (cardId === undefined) {
    return {
      ok: false,
      outcome: targetFailure(
        "an opponent hand card is required (targetOpponentHandCardId missing).",
      ),
    };
  }
  const hand = state.players[opponentOf(context.player)].hand;
  const index = hand.findIndex((c) => c.id === cardId);
  if (index === -1) {
    return {
      ok: false,
      outcome: targetFailure(`No card "${cardId}" in the opponent's hand.`),
    };
  }
  const card = hand[index]!;
  if (requiredType !== undefined && card.type !== requiredType) {
    return {
      ok: false,
      outcome: targetFailure(`${card.name} is not an ${requiredType} card.`),
    };
  }
  return { ok: true, card, index };
}

/** "Your opponent reveals their hand. Take 1 Item card and add it to your hand." */
const stealItemFromHandHandler: EffectHandler = (state, _params, context) => {
  const target = requireOpponentHandCard(state, context, "Item");
  if (!target.ok) return target.outcome;

  const opponent = state.players[opponentOf(context.player)];
  opponent.hand.splice(target.index, 1);
  state.players[context.player].hand.push(target.card);
  state.events.push({
    type: "cardStolenFromHand",
    player: context.player,
    fromPlayer: opponent.id,
    cardId: target.card.id,
  });
  return { resolved: true };
};

/** "Pick 1 Warrior. It gets 500 HEALTH for every Item in your Out deck." */
const healthPerItemInOutDeckHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "any");
  if (!target.ok) return target.outcome;

  const perItem = numberParam(params, ["amount"], 0);
  const itemCount = state.players[context.player].outDeck.filter(
    (c) => c.type === "Item",
  ).length;
  modifyWarriorHealth(state, target.owner, target.warrior, perItem * itemCount);
  return { resolved: true };
};

const WARRIOR_FACTIONS = ["Monk", "Dwarf", "Sonic", "Surfer", "Shaman"] as const;

/**
 * Faction restriction for an effect's target: an explicit targetFaction
 * param wins; otherwise a faction named inside the target keyword counts
 * (e.g. "friendly_monk_warrior" -> Monk). Undefined = unrestricted.
 */
function factionConstraint(params: EffectParams): string | undefined {
  const explicit = stringParam(params, ["targetFaction", "faction"]);
  if (explicit !== undefined) return explicit;
  const keyword = stringParam(params, ["target"]);
  if (keyword !== undefined) {
    const normalized = normalizeEffectCode(keyword);
    for (const faction of WARRIOR_FACTIONS) {
      if (normalized.includes(faction.toUpperCase())) return faction;
    }
  }
  return undefined;
}

/** "Choose 1 Monk Warrior on your side of the field. It can attack twice this turn." */
const extraAttackThisTurnHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  const faction = factionConstraint(params);
  if (faction !== undefined && target.warrior.card.faction !== faction) {
    return targetFailure(`the target must be a ${faction} Warrior.`);
  }
  const amount = numberParam(params, ["amount"], 1);
  target.warrior.attacksRemaining += amount;
  state.events.push({
    type: "extraAttackGranted",
    player: context.player,
    instanceId: target.warrior.instanceId,
    amount,
    attacksRemaining: target.warrior.attacksRemaining,
  });
  return { resolved: true };
};

/** "Destroy 1 Warrior on your opponent's side of the field." */
const destroyTargetWarriorHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "enemy", context.defenderInstanceId);
  if (!target.ok) return target.outcome;

  destroyWarrior(state, target.owner, target.warrior.instanceId);
  return { resolved: true };
};

/** Every Warrior the opponent controls takes `amount` damage. */
const damageAllOpponentWarriorsHandler: EffectHandler = (state, params, context) => {
  const amount = numberParam(params, ["amount"], 0);
  const opponentId = opponentOf(context.player);
  // Iterate a copy: lethal damage splices the field mid-loop.
  for (const warrior of [...state.players[opponentId].field]) {
    modifyWarriorHealth(state, opponentId, warrior, -amount);
  }
  return { resolved: true };
};

/** Every Warrior you control gains `amount` health. */
const healAllYourWarriorsHandler: EffectHandler = (state, params, context) => {
  const amount = numberParam(params, ["amount"], 0);
  for (const warrior of [...state.players[context.player].field]) {
    modifyWarriorHealth(state, context.player, warrior, amount);
  }
  return { resolved: true };
};

/** Best Friend's Bond: the condition may be false — that still resolves. */
const gainSpiritIfTwoSameFactionWarriorsHandler: EffectHandler = (
  state,
  params,
  context,
) => {
  const player = state.players[context.player];
  const counts = new Map<string, number>();
  for (const warrior of player.field) {
    counts.set(warrior.card.faction, (counts.get(warrior.card.faction) ?? 0) + 1);
  }
  if ([...counts.values()].some((n) => n >= 2)) {
    gainSpirit(state, player, numberParam(params, ["amount"], 2));
  }
  return { resolved: true };
};

/** All friendly Warriors of params.targetFaction gain a this-turn attack buff. */
const buffFriendlyFactionThisTurnHandler: EffectHandler = (state, params, context) => {
  const faction = stringParam(params, ["targetFaction", "faction"]);
  if (faction === undefined) {
    return targetFailure("buffFriendlyFactionThisTurn needs a targetFaction param.");
  }
  const amount = numberParam(params, ["amount"], 0);
  for (const warrior of state.players[context.player].field) {
    if (warrior.card.faction !== faction) continue;
    warrior.currentAttack += amount;
    warrior.temporaryAttackBuffs.push({ amount });
    state.events.push({
      type: "warriorAttackModified",
      player: context.player,
      instanceId: warrior.instanceId,
      amount,
      newAttack: warrior.currentAttack,
    });
  }
  return { resolved: true };
};

/**
 * Static Weapon stat bonuses applied at equip time. Safe for
 * "while_equipped" wording because Weapons can never detach — they go to
 * the Out Deck with the Warrior, so the bonus lasts exactly as long.
 */
const weaponAttackHealthBonusHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  const attackBonus = numberParam(params, ["amount"], 0);
  target.warrior.currentAttack += attackBonus;
  state.events.push({
    type: "warriorAttackModified",
    player: target.owner,
    instanceId: target.warrior.instanceId,
    amount: attackBonus,
    newAttack: target.warrior.currentAttack,
  });
  modifyWarriorHealth(
    state,
    target.owner,
    target.warrior,
    numberParam(params, ["secondaryAmount"], 0),
  );
  return { resolved: true };
};

/** Fafnir: `secondaryAmount` attack for params.targetFaction, `amount` otherwise. */
const weaponAttackBonusFactionBonusHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  const faction = stringParam(params, ["targetFaction", "faction"]);
  if (faction === undefined) {
    // Without the faction param we cannot honor the bonus clause; stay
    // pending rather than resolve incorrectly (cards.json data fix needed).
    return targetFailure("targetFaction param missing from card data.");
  }
  const amount =
    target.warrior.card.faction === faction
      ? numberParam(params, ["secondaryAmount"], 0)
      : numberParam(params, ["amount"], 0);
  target.warrior.currentAttack += amount;
  state.events.push({
    type: "warriorAttackModified",
    player: target.owner,
    instanceId: target.warrior.instanceId,
    amount,
    newAttack: target.warrior.currentAttack,
  });
  return { resolved: true };
};

/**
 * Gorgon's Eye: "No attacks can be declared until your next turn." Blocks
 * both players (the controller too — battle follows main, so the controller
 * gives up their own attacks this turn). Expires at the start of the
 * controller's next turn.
 */
const noAttacksUntilNextTurnHandler: EffectHandler = (state, params, context) => {
  addStatus(state, {
    code: "PREVENT_ALL_ATTACKS",
    controller: context.player,
    expiry: { player: context.player, timing: "startOfTurn", turnsRemaining: 1 },
    metadata: { ...params },
  });
  return { resolved: true };
};

/**
 * Orange Court: "Your opponent cannot attack <faction> Warriors on their
 * next turn." The opponent only attacks on their own turn, so a status
 * active from now until the end of their next turn enforces exactly that.
 */
const preventAttacksAgainstFactionNextTurnHandler: EffectHandler = (
  state,
  params,
  context,
) => {
  const faction = factionConstraint(params);
  if (faction === undefined) {
    return targetFailure("targetFaction param missing from card data.");
  }
  const opponent = opponentOf(context.player);
  addStatus(state, {
    code: "PREVENT_ATTACKS_AGAINST_FACTION",
    controller: context.player,
    affectedPlayer: opponent,
    faction,
    expiry: { player: opponent, timing: "endOfTurn", turnsRemaining: 1 },
    metadata: { ...params },
  });
  return { resolved: true };
};

/**
 * High Tea: "If you have 2 or more Warriors on your side of the field:
 * select 1. That Warrior cannot be destroyed this turn. If it would be
 * destroyed, it loses 1000 HEALTH instead." destroyWarrior enforces the
 * status; the health loss is floored at 1 since the protection is absolute.
 */
const protectWarriorThisTurnHandler: EffectHandler = (state, params, context) => {
  if (state.players[context.player].field.length < 2) {
    return targetFailure(
      "you need 2 or more Warriors on your side of the field.",
    );
  }
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  addStatus(state, {
    code: "PREVENT_DESTRUCTION",
    controller: context.player,
    affectedInstanceId: target.warrior.instanceId,
    expiry: { player: context.player, timing: "endOfTurn", turnsRemaining: 1 },
    metadata: { penalty: numberParam(params, ["amount"], 0) },
  });
  return { resolved: true };
};

/**
 * Heaven's Door Izakaya: "On your next turn, all <faction> Warriors on
 * your side of the field gain 1000 ATTACK." A delayed status that fires at
 * the start of the controller's next turn; the buff then lasts that turn.
 */
const nextTurnFactionBuffHandler: EffectHandler = (state, params, context) => {
  const faction = factionConstraint(params);
  if (faction === undefined) {
    return targetFailure("targetFaction param missing from card data.");
  }
  addStatus(state, {
    code: "DELAYED_FACTION_ATTACK_BUFF",
    controller: context.player,
    faction,
    expiry: { player: context.player, timing: "startOfTurn", turnsRemaining: 1 },
    metadata: { amount: numberParam(params, ["amount"], 0) },
  });
  return { resolved: true };
};

/**
 * Training Arc: "Next turn, add 1500 ATTACK to 1 Warrior for 2 turns."
 * The Warrior is chosen now (any side, per the HEAL_TARGET precedent for
 * "1 Warrior"); the buff lands at the start of the controller's next turn
 * and covers secondaryAmount of the Warrior's owner's turns. Fizzles if
 * the Warrior is destroyed while the status is pending.
 */
const delayedAttackBuffHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "any");
  if (!target.ok) return target.outcome;

  addStatus(state, {
    code: "DELAYED_ATTACK_BUFF",
    controller: context.player,
    affectedInstanceId: target.warrior.instanceId,
    expiry: { player: context.player, timing: "startOfTurn", turnsRemaining: 1 },
    metadata: {
      amount: numberParam(params, ["amount"], 0),
      durationTurns: numberParam(params, ["secondaryAmount"], 1),
    },
  });
  return { resolved: true };
};

/**
 * Secure Deposits: "Place 1 Spirit in escrow. In 3 turns, gain 3 Spirit."
 * Rides the existing DelayedEffect system: pay `amount` now, gain
 * `secondaryAmount` after the duration's worth of the controller's turn
 * starts. The escrow payment is on top of the card's Spirit cost (already
 * paid by playItem); too little Spirit left fails safely.
 */
const spiritEscrowHandler: EffectHandler = (state, params, context) => {
  const escrow = numberParam(params, ["amount"], 1);
  const gain = numberParam(params, ["secondaryAmount"], escrow);
  const turns = durationTurns(params, numberParam(params, ["turns"], 0));
  if (turns <= 0) {
    return targetFailure("escrow duration missing from card data.");
  }
  const player = state.players[context.player];
  if (player.spirit < escrow) {
    return targetFailure(
      `placing ${escrow} Spirit in escrow needs ${escrow}; ${player.id} has ${player.spirit}.`,
    );
  }
  player.spirit -= escrow;
  state.events.push({
    type: "spiritChanged",
    player: player.id,
    amount: -escrow,
    total: player.spirit,
  });
  player.delayedEffects.push({
    type: "gainSpirit",
    amount: gain,
    turnsRemaining: turns,
  });
  return { resolved: true };
};

/**
 * Primetime Interview: "Select 1 Warrior on your opponent's side of the
 * field. It is the only Warrior that can attack until your next turn."
 * Scoped to the opponent's attack declarations per the effect key
 * (restrict_opponent_attacks_to_selected_warrior); validateAttacker
 * enforces it, covering direct attacks too.
 */
const restrictOpponentAttackTargetHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "enemy");
  if (!target.ok) return target.outcome;

  addStatus(state, {
    code: "RESTRICT_ATTACKER_TO_WARRIOR",
    controller: context.player,
    affectedPlayer: target.owner,
    affectedInstanceId: target.warrior.instanceId,
    expiry: { player: context.player, timing: "startOfTurn", turnsRemaining: 1 },
  });
  return { resolved: true };
};

/**
 * Moral Determination Authrotity: "Any of your opponent's Warriors that
 * attack next turn can't attack on their next turn." Stage 1: a watch
 * status through the opponent's next turn; recordAttackDeclaration turns
 * each attack into a stage-2 DISABLE_WARRIOR_ATTACKS for the turn after.
 */
const punishAttackersDisableHandler: EffectHandler = (state, _params, context) => {
  const opponent = opponentOf(context.player);
  addStatus(state, {
    code: "PUNISH_ATTACKERS_WATCH",
    controller: context.player,
    affectedPlayer: opponent,
    expiry: { player: opponent, timing: "endOfTurn", turnsRemaining: 1 },
  });
  return { resolved: true };
};

/**
 * A Dragon's Judgement: "Until your next turn, any Warrior that attacks a
 * Monk loses 1000 HEALTH." Side-agnostic per the card text ("any
 * Warrior"); attackWarrior applies the loss after damage resolution.
 */
const monkRetaliationHandler: EffectHandler = (state, params, context) => {
  const faction = factionConstraint(params); // "warriors_attacking_monk" -> Monk
  if (faction === undefined) {
    return targetFailure("retaliation faction missing from card data.");
  }
  addStatus(state, {
    code: "RETALIATE_AGAINST_FACTION_ATTACKERS",
    controller: context.player,
    faction,
    expiry: { player: context.player, timing: "startOfTurn", turnsRemaining: 1 },
    metadata: { amount: numberParam(params, ["amount"], 0) },
  });
  return { resolved: true };
};

/**
 * Pīsubaipā: "Add 1000 damage this turn. The Warrior attacked by this
 * card cannot attack for 2 turns." The bonus buffs the attacker for the
 * turn — the card's damageFormula (attacker_attack + amount) confirms the
 * attack's damage includes it, since effects resolve before combat damage.
 * The defender is then disabled for 2 of its owner's turns.
 */
const attackDamageBonusDisableHandler: EffectHandler = (state, params, context) => {
  if (
    context.attackerInstanceId === undefined ||
    context.defenderInstanceId === undefined
  ) {
    return targetFailure("this Attack card can only be used during an attack.");
  }
  const attacker = findWarrior(state, context.attackerInstanceId);
  const defender = findWarrior(state, context.defenderInstanceId);
  if (attacker === undefined || defender === undefined) {
    return targetFailure("the attacker and defender must both be on the field.");
  }
  const amount = numberParam(params, ["amount"], 0);
  attacker.warrior.currentAttack += amount;
  attacker.warrior.temporaryAttackBuffs.push({ amount });
  state.events.push({
    type: "warriorAttackModified",
    player: attacker.owner,
    instanceId: attacker.warrior.instanceId,
    amount,
    newAttack: attacker.warrior.currentAttack,
  });
  addWarriorAttackDisable(
    state,
    context.player,
    defender.owner,
    defender.warrior.instanceId,
    durationTurns(params, 1),
  );
  return { resolved: true };
};

/**
 * Serf's Bondage: "Deal 1000 damage to up to 2 Warriors on your
 * opponent's side of the field. These Warriors cannot attack on their
 * next turn." First-target version: the attack action carries a single
 * effectTargetInstanceId, so one Warrior is hit (a legal "up to 2"
 * choice), defaulting to the defender. A target the damage destroys
 * gets no disable.
 */
const damageUpToTwoDisableHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "enemy", context.defenderInstanceId);
  if (!target.ok) return target.outcome;

  const instanceId = target.warrior.instanceId;
  modifyWarriorHealth(state, target.owner, target.warrior, -numberParam(params, ["amount"], 0));
  const stillFielded = state.players[target.owner].field.some(
    (w) => w.instanceId === instanceId,
  );
  if (stillFielded) {
    addWarriorAttackDisable(
      state,
      context.player,
      target.owner,
      instanceId,
      durationTurns(params, 1),
    );
  }
  return { resolved: true };
};

/**
 * Gylippus (GYLIPPUS): "Deal 2000 flat damage to the Warrior you attack,
 * plus 1000 additional damage to 1 additional Warrior on your opponent's
 * side of the field." Used as an Attack card; it replaces the normal combat
 * hit (actions.ts), so the attacked Warrior takes a flat `primaryBonus`
 * (2000) regardless of the attacker's ATTACK — never attacker_attack +
 * bonus. A second, distinct enemy Warrior chosen via effectTargetInstanceId
 * additionally takes `secondaryDamage` (1000); a missing / invalid /
 * friendly / same-as-defender second target simply skips that hit (the
 * 2000 still lands). Lethal damage moves a Warrior and its Weapon to the
 * Out Deck.
 */
const gylippusHandler: EffectHandler = (state, params, context) => {
  if (
    context.attackerInstanceId === undefined ||
    context.defenderInstanceId === undefined
  ) {
    return targetFailure("Gylippus can only be used during an attack.");
  }
  const defender = findWarrior(state, context.defenderInstanceId);
  if (defender === undefined || defender.owner === context.player) {
    return targetFailure("the attacked Warrior must be an enemy on the field.");
  }

  // Flat damage to the attacked Warrior (this replaces the combat hit).
  modifyWarriorHealth(
    state,
    defender.owner,
    defender.warrior,
    -numberParam(params, ["primaryBonus"], 0),
  );

  // Additional damage to one other enemy Warrior, when one is validly chosen.
  const secondId = context.targetInstanceId;
  if (secondId !== undefined && secondId !== context.defenderInstanceId) {
    const second = findWarrior(state, secondId);
    if (second !== undefined && second.owner !== context.player) {
      modifyWarriorHealth(
        state,
        second.owner,
        second.warrior,
        -numberParam(params, ["secondaryDamage"], 0),
      );
    }
  }
  return { resolved: true };
};

/**
 * Combat-time Weapon passives (Skeleton Key, Xīwànghǎo, Armageddon,
 * Phobos, Moirai): nothing happens at equip time — actions.ts reads the passive
 * from the attached Weapon during attack resolution, and the attachment's
 * lifetime is the passive's. Resolving here (after validating the equip
 * target) keeps the
 * card from being flagged effectNotImplemented, with no Spirit beyond the
 * equip cost.
 */
const weaponCombatPassiveHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;
  return { resolved: true };
};

/**
 * Apex Forest (ATTACK_TARGET_SPLASH): "Pick one Warrior. Attack it. All
 * other Warriors on your opponent's side of the field take <amount>
 * damage." The chosen defender takes normal combat damage in
 * attackWarrior; this effect (resolved before that, like every other
 * Attack card) splashes every *other* enemy Warrior. Faithful to the card
 * text, the splash is the whole enemy side rather than just the defender's
 * neighbours — the shared splash.ts geometry (otherWarriors) selects them,
 * and adjacency lives in the same module for cards whose text calls for it.
 * Friendly Warriors are never touched (only the opponent's field is read),
 * and lethal splash routes through modifyWarriorHealth -> destroyWarrior,
 * moving slain Warriors and their Weapons to the Out Deck.
 */
const attackTargetSplashHandler: EffectHandler = (state, params, context) => {
  if (context.defenderInstanceId === undefined) {
    return targetFailure("this Attack card can only be used during an attack.");
  }
  const opponentId = opponentOf(context.player);
  const amount = numberParam(params, ["amount"], 0);
  // Snapshot the victims first: lethal splash splices the field mid-loop.
  const victims = otherWarriors(
    state.players[opponentId].field,
    context.defenderInstanceId,
  ).map((w) => w.instanceId);
  for (const instanceId of victims) {
    const warrior = state.players[opponentId].field.find(
      (w) => w.instanceId === instanceId,
    );
    if (warrior === undefined) continue;
    modifyWarriorHealth(state, opponentId, warrior, -amount);
  }
  return { resolved: true };
};

/**
 * Static +`amount` ATTACK at equip time, shared by Weapons whose only
 * equip-time work is a flat ATTACK bonus; their combat behaviour lives in
 * attackWarrior (actions.ts). Static is safe for "while_equipped" because
 * Weapons never detach — they go to the Out Deck with the Warrior, so the
 * bonus lasts exactly as long as the attachment. Used by Scythe Cycle
 * (WEAPON_ATTACK_BONUS_SPLASH: +500, then on-attack splash) and Jesus
 * (WEAPON_ATTACK_BONUS_LEAVE_AT_ONE: +1000, then the non-lethal clamp).
 */
const weaponStaticAttackBonusHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  const attackBonus = numberParam(params, ["amount"], 0);
  target.warrior.currentAttack += attackBonus;
  state.events.push({
    type: "warriorAttackModified",
    player: target.owner,
    instanceId: target.warrior.instanceId,
    amount: attackBonus,
    newAttack: target.warrior.currentAttack,
  });
  return { resolved: true };
};

/**
 * Silurian Period (LINGERING_EXISTING_DAMAGE): "Deal <amount> damage to
 * each of your opponent's Warriors that were on the field when this card
 * was played, for the next <duration> turns." Played as an Attack card
 * (timing on_attack_replace — attackWarrior skips the normal combat hit, so
 * the chosen defender is never double-counted). The handler snapshots the
 * opponent's current Warriors by instance id, deals the first tick now,
 * then schedules the remaining ticks on the controller's delayedEffects so
 * each of their next turns repeats it against the surviving snapshot.
 * Warriors summoned later are never added; destroyed ones drop out; the
 * controller's own Warriors are never touched (only the opponent's field is
 * read). An empty enemy field resolves safely with nothing scheduled.
 */
const lingeringExistingDamageHandler: EffectHandler = (state, params, context) => {
  const opponentId = opponentOf(context.player);
  const amount = numberParam(params, ["amount"], 0);
  const totalTicks = durationTurns(params, 4);
  const snapshot = state.players[opponentId].field.map((w) => w.instanceId);

  // Tick 1, immediately.
  for (const instanceId of snapshot) {
    const warrior = state.players[opponentId].field.find(
      (w) => w.instanceId === instanceId,
    );
    if (warrior === undefined) continue;
    modifyWarriorHealth(state, opponentId, warrior, -amount);
  }

  // Remaining ticks fire at the start of the controller's next turns.
  const remainingTicks = totalTicks - 1;
  if (remainingTicks > 0 && snapshot.length > 0) {
    state.players[context.player].delayedEffects.push({
      type: "lingeringDamage",
      amount,
      turnsRemaining: remainingTicks,
      targetPlayer: opponentId,
      targetInstanceIds: snapshot,
    });
  }
  return { resolved: true };
};

/**
 * Cytotoxic Chapel (DAMAGE_ALL_OPPONENT_WARRIORS_DELAYED): "Deal 1500
 * damage to all Warriors on your opponent's side of the field. All Warriors
 * that took damage from this effect take 500 damage on your next turn."
 * Used as an Attack card; like 7th Plague it is additive — the declared
 * defender still takes its combat hit, so this is NOT a REPLACE_COMBAT
 * effect. It deals `amount` (1500) to every enemy Warrior now, then
 * schedules a single `secondaryAmount` (500) tick against that same
 * snapshot on the controller's next turn, riding the lingeringDamage
 * delayedEffects path (survivors only; destroyed Warriors drop out). The
 * controller's own Warriors are never touched.
 */
const damageAllOpponentWarriorsDelayedHandler: EffectHandler = (
  state,
  params,
  context,
) => {
  const opponentId = opponentOf(context.player);
  const amount = numberParam(params, ["amount"], 0);
  const delayed = numberParam(params, ["secondaryAmount"], 0);
  // Snapshot the Warriors that take damage (for the delayed follow-up).
  const snapshot = state.players[opponentId].field.map((w) => w.instanceId);

  // Immediate AoE; iterate a copy since lethal hits splice the field.
  for (const warrior of [...state.players[opponentId].field]) {
    modifyWarriorHealth(state, opponentId, warrior, -amount);
  }

  // One follow-up tick next turn against the surviving snapshot.
  if (delayed > 0 && snapshot.length > 0) {
    state.players[context.player].delayedEffects.push({
      type: "lingeringDamage",
      amount: delayed,
      turnsRemaining: 1,
      targetPlayer: opponentId,
      targetInstanceIds: snapshot,
    });
  }
  return { resolved: true };
};

/**
 * GILs Unit: pull one friendly Warrior off the field and hold it out of play
 * for `secondaryAmount` of the controller's turns. The Warrior keeps its
 * identity and attached Weapon while away (it does not hit the Out Deck); the
 * timed return at full HEALTH is driven by resolveOutOfPlayReturns (turn.ts).
 */
const temporaryOutOfPlayRestoreHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;

  const turns = numberParam(params, ["secondaryAmount"], durationTurns(params, 3));
  if (turns <= 0) return targetFailure("out-of-play duration must be at least 1 turn.");

  const owner = state.players[target.owner];
  const index = owner.field.findIndex((w) => w.instanceId === target.warrior.instanceId);
  if (index === -1) return targetFailure("target Warrior is no longer on the field.");
  const [warrior] = owner.field.splice(index, 1);

  owner.outOfPlay.push({ warrior: warrior!, turnsRemaining: turns });
  state.events.push({
    type: "warriorSentOutOfPlay",
    player: target.owner,
    instanceId: warrior!.instanceId,
    cardId: warrior!.card.id,
    turnsRemaining: turns,
  });
  return { resolved: true };
};

/**
 * XL-QR517: a friendly Warrior climbs into the tank, taking on the tank's
 * ATTACK/HEALTH (amount/secondaryAmount). Its previous stats are stashed in
 * tankForm and restored when the tank is destroyed (destroyWarrior, turn.ts),
 * which returns the original Warrior to the field in place. Temporary attack
 * buffs are dropped on entry since the tank overrides ATTACK outright.
 */
const tankFormHandler: EffectHandler = (state, params, context) => {
  const target = requireWarriorTarget(state, params, context, "friendly");
  if (!target.ok) return target.outcome;
  const warrior = target.warrior;
  if (warrior.tankForm !== undefined) {
    return targetFailure("that Warrior is already in the tank.");
  }

  const tankAttack = numberParam(params, ["amount"], 1500);
  const tankHealth = numberParam(params, ["secondaryAmount"], 3100);
  const buffTotal = warrior.temporaryAttackBuffs.reduce((sum, b) => sum + b.amount, 0);

  warrior.tankForm = {
    originalAttack: warrior.currentAttack - buffTotal,
    originalHealth: warrior.currentHealth,
    originalMaxHealth: warrior.maxHealth,
  };
  warrior.temporaryAttackBuffs = [];
  warrior.currentAttack = tankAttack;
  warrior.currentHealth = tankHealth;
  warrior.maxHealth = tankHealth;

  state.events.push({
    type: "warriorEnteredTank",
    player: target.owner,
    instanceId: warrior.instanceId,
    cardId: warrior.card.id,
    attack: tankAttack,
    health: tankHealth,
  });
  return { resolved: true };
};

/** Pool both players' Spirit; the activator takes the rounded-up half. */
const slushFundHandler: EffectHandler = (state, _params, context) => {
  const me = state.players[context.player];
  const opponent = state.players[opponentOf(context.player)];
  const pot = me.spirit + opponent.spirit;
  const mine = Math.ceil(pot / 2);
  const theirs = pot - mine;

  state.events.push(
    { type: "spiritChanged", player: me.id, amount: mine - me.spirit, total: mine },
    { type: "spiritChanged", player: opponent.id, amount: theirs - opponent.spirit, total: theirs },
  );
  me.spirit = mine;
  opponent.spirit = theirs;
  return { resolved: true };
};

export function createDefaultEffectRegistry(): EffectRegistry {
  const registry = new EffectRegistry();
  registry.register("gainSpirit", gainSpiritHandler);
  registry.register("drawCards", drawCardsHandler);
  registry.register("modifyAttack", modifyAttackHandler);
  registry.register("modifyHealth", modifyHealthHandler);
  registry.register("dealDamageToWarrior", dealDamageToWarriorHandler);

  // Aliases for effectCode values already used in cards.json whose mapping
  // to a generic handler is obvious. (GAIN_SPIRIT and DRAW_CARDS need no
  // alias: normalization already matches them to gainSpirit/drawCards.)
  registry.register("DAMAGE_TARGET", dealDamageToWarriorHandler);
  registry.register("HEAL_TARGET", modifyHealthHandler);
  // Group 2A: enemy-only targeted destruction.
  registry.register("DESTROY_TARGET_WARRIOR", destroyTargetWarriorHandler);
  // Group 2B-1: revive from the controller's own Out Deck.
  registry.register("REVIVE_WARRIOR", reviveWarriorHandler);
  // Group 2B-2: computed heal scaling with Out Deck Items.
  registry.register("HEALTH_PER_ITEM_IN_OUT_DECK", healthPerItemInOutDeckHandler);
  // Group 2B-3: one additional attack this turn for a friendly Warrior.
  registry.register("EXTRA_ATTACK_THIS_TURN", extraAttackThisTurnHandler);
  // Group 3A: tutor a constrained card from the deck to hand.
  registry.register("SEARCH_DECK", searchDeckHandler);
  // Group 3B: take an Item from the opponent's hand.
  registry.register("STEAL_ITEM_FROM_HAND", stealItemFromHandHandler);
  // +2000-damage Attack cards buff the attacker for the turn.
  registry.register("ATTACK_DAMAGE_BONUS", modifyAttackHandler);

  // Group 1: no-choice effects resolvable with existing engine state.
  registry.register("DAMAGE_ALL_OPPONENT_WARRIORS", damageAllOpponentWarriorsHandler);
  registry.register("HEAL_ALL_YOUR_WARRIORS", healAllYourWarriorsHandler);
  registry.register(
    "GAIN_SPIRIT_IF_TWO_SAME_FACTION_WARRIORS",
    gainSpiritIfTwoSameFactionWarriorsHandler,
  );
  registry.register("BUFF_FRIENDLY_FACTION_THIS_TURN", buffFriendlyFactionThisTurnHandler);
  registry.register("WEAPON_ATTACK_HEALTH_BONUS", weaponAttackHealthBonusHandler);
  registry.register(
    "WEAPON_ATTACK_BONUS_FACTION_BONUS",
    weaponAttackBonusFactionBonusHandler,
  );
  registry.register("SLUSH_FUND", slushFundHandler);

  // Group 5A: status/aura foundation — attack-prevention statuses.
  registry.register("NO_ATTACKS_UNTIL_NEXT_TURN", noAttacksUntilNextTurnHandler);
  registry.register(
    "PREVENT_ATTACKS_AGAINST_FACTION_NEXT_TURN",
    preventAttacksAgainstFactionNextTurnHandler,
  );

  // Group 5B: remaining simple status/delayed effects.
  registry.register("PROTECT_WARRIOR_THIS_TURN", protectWarriorThisTurnHandler);
  registry.register("NEXT_TURN_FACTION_BUFF", nextTurnFactionBuffHandler);
  registry.register("DELAYED_ATTACK_BUFF", delayedAttackBuffHandler);
  registry.register("SPIRIT_ESCROW", spiritEscrowHandler);

  // Group 4A: combat hooks riding the status/aura system.
  registry.register(
    "RESTRICT_OPPONENT_ATTACK_TARGET",
    restrictOpponentAttackTargetHandler,
  );
  registry.register("PUNISH_ATTACKERS_DISABLE", punishAttackersDisableHandler);
  registry.register("MONK_RETALIATION", monkRetaliationHandler);

  // Group 4B: Attack-card combat modifiers with disable riders.
  registry.register("ATTACK_DAMAGE_BONUS_DISABLE", attackDamageBonusDisableHandler);
  registry.register("DAMAGE_UP_TO_TWO_DISABLE", damageUpToTwoDisableHandler);

  // Group 4C: Weapon combat passives, enforced in computeCombatDamage
  // (actions.ts); these equip-time registrations just clear the marker.
  registry.register("WEAPON_HALVE_INCOMING_DAMAGE", weaponCombatPassiveHandler);
  registry.register(
    "WEAPON_ADD_ATTACK_DIFFERENCE_DAMAGE",
    weaponCombatPassiveHandler,
  );

  // Group 4D: more Weapon combat passives enforced in attackWarrior /
  // computeCombatDamage (actions.ts). Armageddon's per-destroyed-friendly
  // bonus and Phobos's disable-on-hit both live on the attached Weapon, so
  // equip just clears the marker.
  registry.register(
    "WEAPON_ATTACK_PER_DESTROYED_FRIENDLY",
    weaponCombatPassiveHandler,
  );
  registry.register(
    "WEAPON_DISABLE_ATTACKED_ONE_TURN",
    weaponCombatPassiveHandler,
  );

  // Group 4E: Moirai. When the equipped Warrior attacks, it grants one
  // other friendly Warrior an extra attack (attackWarrior, actions.ts);
  // equip just clears the marker like the other combat passives.
  registry.register(
    "WEAPON_GRANT_OTHER_EXTRA_ATTACK",
    weaponCombatPassiveHandler,
  );

  // Apotheosis: the equipped Warrior's outgoing damage is half the
  // defender's HEALTH, enforced in computeCombatDamage (actions.ts); equip
  // just clears the marker.
  registry.register("WEAPON_HALF_HEALTH_DAMAGE", weaponCombatPassiveHandler);

  // Gilgamesh: vs a higher-ATTACK defender, the equipped Warrior hits at the
  // higher ATTACK (computeCombatDamage, actions.ts); equip clears the marker.
  registry.register("WEAPON_EQUALIZE_VS_HIGHER_ATTACK", weaponCombatPassiveHandler);

  // Jesus: +amount ATTACK at equip; the "cannot destroy — leave at 1" clamp
  // on the attacked Warrior is a combat hook in attackWarrior (actions.ts).
  registry.register(
    "WEAPON_ATTACK_BONUS_LEAVE_AT_ONE",
    weaponStaticAttackBonusHandler,
  );

  // Ontology: negate the first attack against the equipped Warrior each turn
  // and debuff any attacker that hits it — both enforced in attackWarrior
  // (actions.ts); equip just clears the marker.
  registry.register(
    "WEAPON_NEGATE_ONCE_REDUCE_ATTACKER",
    weaponCombatPassiveHandler,
  );

  // Group 4F: splash / adjacency combat targeting (shared splash.ts
  // geometry). Apex Forest splashes all other enemy Warriors when its
  // Attack card resolves; Scythe Cycle adds static ATTACK at equip and
  // splashes one selected enemy on attack (the splash hook lives in
  // attackWarrior, actions.ts).
  registry.register("ATTACK_TARGET_SPLASH", attackTargetSplashHandler);
  registry.register("WEAPON_ATTACK_BONUS_SPLASH", weaponStaticAttackBonusHandler);

  // Group 4G: Silurian Period's recurring snapshot damage. Resolves through
  // this pipeline (an Attack card); the per-turn ticks ride the
  // delayedEffects system (resolveDelayedEffects in turn.ts).
  registry.register("LINGERING_EXISTING_DAMAGE", lingeringExistingDamageHandler);

  // Group 6A: Gylippus — flat primaryBonus to the attacked Warrior (replaces
  // the combat hit, see actions.ts) plus secondaryDamage to one other enemy.
  registry.register("GYLIPPUS", gylippusHandler);

  // Group 6B: Cytotoxic Chapel — AoE now (additive with combat, like 7th
  // Plague) plus a one-tick delayed follow-up next turn via lingeringDamage.
  registry.register(
    "DAMAGE_ALL_OPPONENT_WARRIORS_DELAYED",
    damageAllOpponentWarriorsDelayedHandler,
  );

  // GILs Unit: remove a friendly Warrior from play for a few of the
  // controller's turns; it returns at full HEALTH (resolveOutOfPlayReturns,
  // turn.ts).
  registry.register(
    "TEMPORARY_OUT_OF_PLAY_RESTORE",
    temporaryOutOfPlayRestoreHandler,
  );

  // XL-QR517: transform a friendly Warrior into the tank; on the tank's
  // destruction the original Warrior returns in place (destroyWarrior,
  // turn.ts).
  registry.register("TANK_FORM", tankFormHandler);
  return registry;
}

export const defaultEffectRegistry: EffectRegistry = createDefaultEffectRegistry();
