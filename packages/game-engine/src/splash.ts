/**
 * Field-geometry helpers for splash / adjacency combat effects. A player's
 * `field` array is ordered left-to-right by slot, so a Warrior's array
 * index is its slot and its neighbours are the entries on either side.
 *
 * These helpers are pure (read-only) and side-agnostic: they only pick
 * *which* Warriors a splash touches. Callers apply the damage through the
 * usual destruction path (modifyWarriorHealth / destroyWarrior), which
 * already moves a slain Warrior and its attached Weapon to the Out Deck.
 * Keeping this module dependency-free (only ./types) avoids the import
 * cycle that pulling in turn.ts here would create.
 */
import type { WarriorInPlay } from "./types";

/** The Warrior's slot index on this field, or -1 if it is not present. */
export function fieldSlot(
  field: readonly WarriorInPlay[],
  instanceId: string,
): number {
  return field.findIndex((w) => w.instanceId === instanceId);
}

/**
 * The Warriors immediately to the left and right of `instanceId`'s slot.
 * A side with no neighbour — an edge slot, or a Warrior that is not on the
 * field — is `undefined`, so callers naturally do nothing on that side.
 */
export function adjacentWarriors(
  field: readonly WarriorInPlay[],
  instanceId: string,
): { left?: WarriorInPlay; right?: WarriorInPlay } {
  const slot = fieldSlot(field, instanceId);
  if (slot === -1) return {};
  return { left: field[slot - 1], right: field[slot + 1] };
}

/** Both adjacent Warriors as a flat list (0–2 entries); edges omitted. */
export function adjacentWarriorList(
  field: readonly WarriorInPlay[],
  instanceId: string,
): WarriorInPlay[] {
  const { left, right } = adjacentWarriors(field, instanceId);
  const list: WarriorInPlay[] = [];
  if (left !== undefined) list.push(left);
  if (right !== undefined) list.push(right);
  return list;
}

/** Every Warrior on the field except `instanceId` (preserves slot order). */
export function otherWarriors(
  field: readonly WarriorInPlay[],
  instanceId: string,
): WarriorInPlay[] {
  return field.filter((w) => w.instanceId !== instanceId);
}
