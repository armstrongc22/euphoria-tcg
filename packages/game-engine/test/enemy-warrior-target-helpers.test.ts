/**
 * Helpers the manual-match UI uses to surface the enemy-Warrior target choice
 * for Items like Coerced Loyalty (CONTROL_STEAL) and Primetime Interview
 * (RESTRICT_OPPONENT_ATTACK_TARGET). The engine's actual resolution is covered
 * in control-steal.test.ts and the status tests.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  getEnemyWarriorTargets,
  isEnemyWarriorTargetItem,
} from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, putWarriorOnField } from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });
const steal = () => makeItemCard({ effectCode: "CONTROL_STEAL" });
const restrict = () => makeItemCard({ effectCode: "RESTRICT_OPPONENT_ATTACK_TARGET" });

describe("isEnemyWarriorTargetItem", () => {
  it("is true for CONTROL_STEAL and RESTRICT_OPPONENT_ATTACK_TARGET Items", () => {
    expect(isEnemyWarriorTargetItem(steal())).toBe(true);
    expect(isEnemyWarriorTargetItem(restrict())).toBe(true);
  });

  it("is false for a plain Item, a non-Item, or a friendly-target Item", () => {
    expect(isEnemyWarriorTargetItem(makeItemCard())).toBe(false);
    expect(isEnemyWarriorTargetItem(makeWarriorCard({ effectCode: "CONTROL_STEAL" }))).toBe(false);
    expect(isEnemyWarriorTargetItem(makeItemCard({ effectCode: "TEMPORARY_OUT_OF_PLAY_RESTORE" }))).toBe(false);
  });
});

describe("getEnemyWarriorTargets", () => {
  it("returns the opponent's Warriors on the field", () => {
    const game = newGame();
    const a = putWarriorOnField(game, "player2");
    const b = putWarriorOnField(game, "player2");
    const ids = getEnemyWarriorTargets(game, restrict()).map((w) => w.instanceId);
    expect(ids.sort()).toEqual([a.instanceId, b.instanceId].sort());
  });

  it("is empty when the opponent controls no Warrior", () => {
    expect(getEnemyWarriorTargets(newGame(), restrict())).toHaveLength(0);
  });

  it("reads the opponent's field, not the active player's own", () => {
    const game = newGame();
    putWarriorOnField(game, "player1");
    expect(getEnemyWarriorTargets(game, restrict())).toHaveLength(0);
  });

  it("CONTROL_STEAL excludes a Warrior whose control is already contested", () => {
    const game = newGame();
    const free = putWarriorOnField(game, "player2");
    putWarriorOnField(game, "player2", { stolenFrom: "player1" });
    const ids = getEnemyWarriorTargets(game, steal()).map((w) => w.instanceId);
    expect(ids).toEqual([free.instanceId]);
  });

  it("CONTROL_STEAL offers nothing when the active player's field is full", () => {
    const game = newGame();
    putWarriorOnField(game, "player2"); // a valid enemy target exists
    for (let i = 0; i < game.config.warriorSlots; i++) putWarriorOnField(game, "player1");
    expect(getEnemyWarriorTargets(game, steal())).toHaveLength(0);
    // A non-CONTROL_STEAL enemy item is unaffected by the field-full rule.
    expect(getEnemyWarriorTargets(game, restrict())).toHaveLength(1);
  });
});
