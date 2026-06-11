/**
 * Effect registry: resolves card effects by effectCode/effectParams from
 * card data. Handlers mutate a draft state that EffectRegistry.resolve
 * clones internally, so a handler that fails or throws can never corrupt
 * the caller's state — the untouched input state is returned instead.
 */
import type { Card } from "@euphoria/card-data";
import { destroyWarrior, drawCards, gainSpirit } from "./turn";
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
]);

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

  const amount = numberParam(params, ["amount"], 0);
  found.warrior.currentHealth += amount;
  found.warrior.maxHealth = Math.max(
    found.warrior.maxHealth,
    found.warrior.currentHealth,
  );
  state.events.push({
    type: "warriorHealthModified",
    player: found.owner,
    instanceId: targetId,
    amount,
    newHealth: found.warrior.currentHealth,
  });
  if (found.warrior.currentHealth <= 0) {
    destroyWarrior(state, found.owner, targetId);
  }
  return { resolved: true };
};

const dealDamageToWarriorHandler: EffectHandler = (state, params, context) => {
  const targetId = resolveTargetInstanceId(params, context, context.defenderInstanceId);
  if (targetId === undefined) return targetFailure("dealDamageToWarrior needs a target Warrior.");
  const found = findWarrior(state, targetId);
  if (found === undefined) return targetFailure(`No Warrior "${targetId}" on the field.`);

  const amount = numberParam(params, ["amount"], 0);
  found.warrior.currentHealth -= amount;
  state.events.push({
    type: "warriorHealthModified",
    player: found.owner,
    instanceId: targetId,
    amount: -amount,
    newHealth: found.warrior.currentHealth,
  });
  if (found.warrior.currentHealth <= 0) {
    destroyWarrior(state, found.owner, targetId);
  }
  return { resolved: true };
};

export function createDefaultEffectRegistry(): EffectRegistry {
  const registry = new EffectRegistry();
  registry.register("gainSpirit", gainSpiritHandler);
  registry.register("drawCards", drawCardsHandler);
  registry.register("modifyAttack", modifyAttackHandler);
  registry.register("modifyHealth", modifyHealthHandler);
  registry.register("dealDamageToWarrior", dealDamageToWarriorHandler);
  return registry;
}

export const defaultEffectRegistry: EffectRegistry = createDefaultEffectRegistry();
