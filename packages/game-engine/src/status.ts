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
 * the ones that hit zero. Called from runStartPhase ("startOfTurn") and
 * runEndPhase ("endOfTurn") for the active player only.
 */
export function expireStatuses(
  state: GameState,
  playerId: PlayerId,
  timing: StatusExpiryTiming,
): void {
  const remaining: StatusEffect[] = [];
  for (const status of state.statuses) {
    if (status.expiry.player !== playerId || status.expiry.timing !== timing) {
      remaining.push(status);
      continue;
    }
    const turnsRemaining = status.expiry.turnsRemaining - 1;
    if (turnsRemaining <= 0) {
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
