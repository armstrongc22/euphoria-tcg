/**
 * Status/aura lifecycle and queries. Statuses are temporary game-wide
 * modifiers created by card effects (see StatusEffect in types.ts). Like
 * the turn helpers, these functions mutate the state they are given;
 * callers clone first (applyAction / EffectRegistry.resolve already do).
 */
import type {
  GameState,
  PlayerId,
  StatusEffect,
  StatusExpiryTiming,
  WarriorInPlay,
} from "./types";

/** Adds a status with a fresh unique id and logs it. */
export function addStatus(
  state: GameState,
  status: Omit<StatusEffect, "id">,
): StatusEffect {
  const withId: StatusEffect = { ...status, id: `status-${state.nextStatusId}` };
  state.nextStatusId += 1;
  state.statuses.push(withId);
  state.events.push({
    type: "statusApplied",
    player: withId.controller,
    statusId: withId.id,
    code: withId.code,
  });
  return withId;
}

/**
 * Counts down statuses keyed to this player's turn boundary and removes
 * the ones that hit zero, returning the removed ones. Called from
 * runStartPhase ("startOfTurn") and runEndPhase ("endOfTurn") for the
 * active player only; the caller passes the returned statuses to
 * triggerExpiredStatuses so delayed statuses fire as they leave play.
 */
export function expireStatuses(
  state: GameState,
  playerId: PlayerId,
  timing: StatusExpiryTiming,
): StatusEffect[] {
  const remaining: StatusEffect[] = [];
  const expired: StatusEffect[] = [];
  for (const status of state.statuses) {
    if (status.expiry.player !== playerId || status.expiry.timing !== timing) {
      remaining.push(status);
      continue;
    }
    const turnsRemaining = status.expiry.turnsRemaining - 1;
    if (turnsRemaining <= 0) {
      expired.push(status);
      state.events.push({
        type: "statusExpired",
        player: status.controller,
        statusId: status.id,
        code: status.code,
      });
      continue;
    }
    remaining.push({ ...status, expiry: { ...status.expiry, turnsRemaining } });
  }
  state.statuses = remaining;
  return expired;
}

/** Reads a numeric metadata field, tolerating absent/foreign values. */
function numberMetadata(
  status: StatusEffect,
  key: string,
  fallback: number,
): number {
  const value = status.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function findWarriorAnywhere(
  state: GameState,
  instanceId: string | undefined,
): { warrior: WarriorInPlay; owner: PlayerId } | undefined {
  if (instanceId === undefined) return undefined;
  for (const owner of ["player1", "player2"] as const) {
    const warrior = state.players[owner].field.find(
      (w) => w.instanceId === instanceId,
    );
    if (warrior !== undefined) return { warrior, owner };
  }
  return undefined;
}

function applyTemporaryAttackBuff(
  state: GameState,
  owner: PlayerId,
  warrior: WarriorInPlay,
  amount: number,
  turnsRemaining: number,
): void {
  if (amount === 0) return;
  warrior.currentAttack += amount;
  warrior.temporaryAttackBuffs.push({ amount, turnsRemaining });
  state.events.push({
    type: "warriorAttackModified",
    player: owner,
    instanceId: warrior.instanceId,
    amount,
    newAttack: warrior.currentAttack,
  });
}

/**
 * Fires the delayed statuses among the ones expireStatuses just removed.
 * Delayed statuses (DELAYED_*) sit dormant until their boundary, then act
 * here; pure restriction statuses (PREVENT_*) have nothing to fire. A
 * DELAYED_ATTACK_BUFF whose Warrior left the field fizzles silently.
 *
 * Buffs applied here use the temporaryAttackBuffs machinery, and the
 * caller runs this after expireTemporaryBuffs, so a buff granted at the
 * start of turn T survives until the start of the owner's next turn (or
 * later, per turnsRemaining).
 */
export function triggerExpiredStatuses(
  state: GameState,
  expired: readonly StatusEffect[],
): void {
  for (const status of expired) {
    switch (status.code) {
      case "DELAYED_FACTION_ATTACK_BUFF": {
        const amount = numberMetadata(status, "amount", 0);
        for (const warrior of state.players[status.controller].field) {
          if (status.faction !== undefined && warrior.card.faction !== status.faction) {
            continue;
          }
          applyTemporaryAttackBuff(state, status.controller, warrior, amount, 1);
        }
        break;
      }
      case "DELAYED_ATTACK_BUFF": {
        const found = findWarriorAnywhere(state, status.affectedInstanceId);
        if (found === undefined) break;
        applyTemporaryAttackBuff(
          state,
          found.owner,
          found.warrior,
          numberMetadata(status, "amount", 0),
          numberMetadata(status, "durationTurns", 1),
        );
        break;
      }
      case "DISABLE_WARRIOR_ATTACKS": {
        // Fires during the punished Warrior's owner's Start Phase, after
        // the refresh reset attacksRemaining to 1 — so the Warrior simply
        // has no attacks this turn, and the existing WARRIOR_EXHAUSTED /
        // getLegalActions machinery enforces the disable.
        const found = findWarriorAnywhere(state, status.affectedInstanceId);
        if (found === undefined) break;
        found.warrior.attacksRemaining = 0;
        state.events.push({
          type: "warriorAttacksDisabled",
          player: found.owner,
          instanceId: found.warrior.instanceId,
        });
        break;
      }
      default:
        break;
    }
  }
}

/**
 * The status shielding this Warrior from destruction, if any (High Tea).
 * Checked by destroyWarrior, the single destruction choke point.
 */
export function findDestructionProtection(
  state: GameState,
  instanceId: string,
): StatusEffect | undefined {
  return state.statuses.find(
    (s) =>
      s.code === "PREVENT_DESTRUCTION" &&
      (s.affectedInstanceId === undefined || s.affectedInstanceId === instanceId),
  );
}

/** The health a prevented destruction costs the protected Warrior. */
export function destructionPreventionPenalty(status: StatusEffect): number {
  return numberMetadata(status, "penalty", 0);
}

/**
 * The status forbidding this attacker because a different Warrior is "the
 * only Warrior that can attack", if any (Primetime Interview). The
 * designated Warrior itself is never restricted.
 */
export function findAttackerRestriction(
  state: GameState,
  attackingPlayer: PlayerId,
  attackerInstanceId: string,
): StatusEffect | undefined {
  return state.statuses.find(
    (s) =>
      s.code === "RESTRICT_ATTACKER_TO_WARRIOR" &&
      (s.affectedPlayer === undefined || s.affectedPlayer === attackingPlayer) &&
      s.affectedInstanceId !== attackerInstanceId,
  );
}

/**
 * After-attack-declaration hook (Moral Determination Authrotity): while a
 * PUNISH_ATTACKERS_WATCH covers the attacking player, each attacking
 * Warrior earns a delayed DISABLE_WARRIOR_ATTACKS for its owner's next
 * turn. Called by attackWarrior and directAttack once the attack is
 * declared; repeat attacks by the same Warrior do not stack disables.
 */
export function recordAttackDeclaration(
  state: GameState,
  attackingPlayer: PlayerId,
  attackerInstanceId: string,
): void {
  const watch = state.statuses.find(
    (s) =>
      s.code === "PUNISH_ATTACKERS_WATCH" &&
      (s.affectedPlayer === undefined || s.affectedPlayer === attackingPlayer),
  );
  if (watch === undefined) return;
  const alreadyPunished = state.statuses.some(
    (s) =>
      s.code === "DISABLE_WARRIOR_ATTACKS" &&
      s.affectedInstanceId === attackerInstanceId,
  );
  if (alreadyPunished) return;
  addWarriorAttackDisable(state, watch.controller, attackingPlayer, attackerInstanceId, 1);
}

/**
 * Disables a Warrior's attacks for `turns` of its owner's turns: one
 * staggered delayed DISABLE_WARRIOR_ATTACKS per turn, each firing at a
 * successive owner Start Phase (after the refresh, see the trigger).
 * Used by the punish watch (1 turn) and by Attack-card riders like
 * Pīsubaipā ("cannot attack for 2 turns"). Each status fizzles if the
 * Warrior has left the field by its boundary.
 */
export function addWarriorAttackDisable(
  state: GameState,
  controller: PlayerId,
  ownerId: PlayerId,
  instanceId: string,
  turns: number,
): void {
  for (let turn = 1; turn <= turns; turn++) {
    addStatus(state, {
      code: "DISABLE_WARRIOR_ATTACKS",
      controller,
      affectedPlayer: ownerId,
      affectedInstanceId: instanceId,
      expiry: { player: ownerId, timing: "startOfTurn", turnsRemaining: turn },
    });
  }
}

/**
 * The statuses retaliating against attacks on `defenderFaction` Warriors
 * (A Dragon's Judgement). Side-agnostic: the card text punishes "any
 * Warrior that attacks a Monk". Damage application stays in actions.ts
 * (it needs destroyWarrior, which would cycle the imports here).
 */
export function findRetaliationStatuses(
  state: GameState,
  defenderFaction: string,
): StatusEffect[] {
  return state.statuses.filter(
    (s) =>
      s.code === "RETALIATE_AGAINST_FACTION_ATTACKERS" &&
      (s.faction === undefined || s.faction === defenderFaction),
  );
}

/** The health an attacker loses to one retaliation status. */
export function retaliationHealthLoss(status: StatusEffect): number {
  return numberMetadata(status, "amount", 0);
}

/**
 * The status blocking all attack declarations right now, if any
 * (Gorgon's Eye). Applies to both players, including the controller.
 */
export function findAttackPreventionStatus(
  state: GameState,
): StatusEffect | undefined {
  return state.statuses.find((s) => s.code === "PREVENT_ALL_ATTACKS");
}

/**
 * The status protecting this defender from this attacker, if any
 * (Orange Court). Unset scope fields on a status mean "unrestricted":
 * a missing affectedPlayer constrains both players, a missing faction
 * covers all of the controller's Warriors, etc.
 */
export function findAttackTargetProtection(
  state: GameState,
  attackingPlayer: PlayerId,
  defenderOwner: PlayerId,
  defender: WarriorInPlay,
): StatusEffect | undefined {
  return state.statuses.find(
    (s) =>
      s.code === "PREVENT_ATTACKS_AGAINST_FACTION" &&
      s.controller === defenderOwner &&
      (s.affectedPlayer === undefined || s.affectedPlayer === attackingPlayer) &&
      (s.faction === undefined || s.faction === defender.card.faction) &&
      (s.affectedInstanceId === undefined ||
        s.affectedInstanceId === defender.instanceId),
  );
}
