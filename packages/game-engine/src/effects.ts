/**
 * Effect registry: resolves card effects by effectCode/effectParams from
 * card data. Handlers mutate a draft state that EffectRegistry.resolve
 * clones internally, so a handler that fails or throws can never corrupt
 * the caller's state — the untouched input state is returned instead.
 */
import type { Card } from "@euphoria/card-data";
import { destroyWarrior, drawCards, gainSpirit, opponentOf } from "./turn";
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

/** Positive amounts heal (overheal raises max health); negative ones harm. */
const modifyHealthHandler: EffectHandler = (state, params, context) => {
  const targetId = resolveTargetInstanceId(params, context, context.attackerInstanceId);
  if (targetId === undefined) return targetFailure("modifyHealth needs a target Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  modifyWarriorHealth(state, found.owner, found.warrior, numberParam(params, ["amount"], 0));
  return { resolved: true };
};

const dealDamageToWarriorHandler: EffectHandler = (state, params, context) => {
  const targetId = resolveTargetInstanceId(params, context, context.defenderInstanceId);
  if (targetId === undefined) return targetFailure("dealDamageToWarrior needs a target Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  modifyWarriorHealth(state, found.owner, found.warrior, -numberParam(params, ["amount"], 0));
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
  const targetId = context.targetInstanceId;
  if (targetId === undefined) return targetFailure("needs the equipped Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  const attackBonus = numberParam(params, ["amount"], 0);
  found.warrior.currentAttack += attackBonus;
  state.events.push({
    type: "warriorAttackModified",
    player: found.owner,
    instanceId: targetId,
    amount: attackBonus,
    newAttack: found.warrior.currentAttack,
  });
  modifyWarriorHealth(
    state,
    found.owner,
    found.warrior,
    numberParam(params, ["secondaryAmount"], 0),
  );
  return { resolved: true };
};

/** Fafnir: `secondaryAmount` attack for params.targetFaction, `amount` otherwise. */
const weaponAttackBonusFactionBonusHandler: EffectHandler = (state, params, context) => {
  const targetId = context.targetInstanceId;
  if (targetId === undefined) return targetFailure("needs the equipped Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  const faction = stringParam(params, ["targetFaction", "faction"]);
  if (faction === undefined) {
    // Without the faction param we cannot honor the bonus clause; stay
    // pending rather than resolve incorrectly (cards.json data fix needed).
    return targetFailure("targetFaction param missing from card data.");
  }
  const amount =
    found.warrior.card.faction === faction
      ? numberParam(params, ["secondaryAmount"], 0)
      : numberParam(params, ["amount"], 0);
  found.warrior.currentAttack += amount;
  state.events.push({
    type: "warriorAttackModified",
    player: found.owner,
    instanceId: targetId,
    amount,
    newAttack: found.warrior.currentAttack,
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
  return registry;
}

export const defaultEffectRegistry: EffectRegistry = createDefaultEffectRegistry();
