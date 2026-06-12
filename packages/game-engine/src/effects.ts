/**
 * Effect registry: resolves card effects by effectCode/effectParams from
 * card data. Handlers mutate a draft state that EffectRegistry.resolve
 * clones internally, so a handler that fails or throws can never corrupt
 * the caller's state — the untouched input state is returned instead.
 */
import type { Card } from "@euphoria/card-data";
import { addStatus } from "./status";
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
  return registry;
}

export const defaultEffectRegistry: EffectRegistry = createDefaultEffectRegistry();
