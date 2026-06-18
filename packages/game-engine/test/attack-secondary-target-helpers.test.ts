/**
 * Helpers the manual-match UI uses to surface an attack's optional secondary
 * target (carried on attack.effectTargetInstanceId): Gylippus's extra enemy,
 * Scythe Cycle's splash enemy, and Moirai's other friendly Warrior. The full
 * combat resolution is also covered in group6a (Gylippus), group4f (Scythe
 * Cycle) and group4e (Moirai); these add the target-discovery helpers plus a
 * focused check that the action payload plumbs effectTargetInstanceId through.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  getGylippusSecondaryTargets,
  getMoiraiExtraAttackTargets,
  getScytheCycleSplashTargets,
  isGylippusAttackCard,
  type GameState,
} from "../src/index";
import {
  makeAttackCard,
  makeDecks,
  makeItemCard,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });
const gylippus = () => makeAttackCard("Monk", { effectCode: "GYLIPPUS" });

/** Player 1, turn 3, Main Phase, empty hand — ready to set up a battle. */
function toBattleReady(): GameState {
  let g = newGame();
  g = mustApply(g, { kind: "endTurn" }); // player2, turn 2
  g = mustApply(g, { kind: "endTurn" }); // player1, turn 3
  g.players.player1.hand = [];
  return g;
}

describe("isGylippusAttackCard", () => {
  it("is true for the Gylippus Attack card", () => {
    expect(isGylippusAttackCard(gylippus())).toBe(true);
  });

  it("is false for a non-Attack card or another Attack effect", () => {
    expect(isGylippusAttackCard(makeItemCard({ effectCode: "GYLIPPUS" }))).toBe(false);
    expect(isGylippusAttackCard(makeWarriorCard({ effectCode: "GYLIPPUS" }))).toBe(false);
    expect(isGylippusAttackCard(makeAttackCard("Monk", { effectCode: "DECIMATION" }))).toBe(false);
  });
});

describe("getGylippusSecondaryTargets", () => {
  it("returns the opponent's Warriors other than the attacked defender", () => {
    const g = newGame();
    const defender = putWarriorOnField(g, "player2");
    const other = putWarriorOnField(g, "player2");
    const ids = getGylippusSecondaryTargets(g, gylippus(), defender.instanceId).map(
      (w) => w.instanceId,
    );
    expect(ids).toEqual([other.instanceId]);
  });

  it("is empty when the defender is the opponent's only Warrior", () => {
    const g = newGame();
    const defender = putWarriorOnField(g, "player2");
    expect(getGylippusSecondaryTargets(g, gylippus(), defender.instanceId)).toHaveLength(0);
  });

  it("is empty for a non-Gylippus card", () => {
    const g = newGame();
    const defender = putWarriorOnField(g, "player2");
    putWarriorOnField(g, "player2");
    expect(
      getGylippusSecondaryTargets(g, makeAttackCard("Monk"), defender.instanceId),
    ).toHaveLength(0);
  });
});

describe("getScytheCycleSplashTargets", () => {
  const scythe = () => realCard("scythe-cycle");

  it("returns enemy Warriors other than the defender when the attacker has Scythe Cycle", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: scythe() });
    const defender = putWarriorOnField(g, "player2");
    const other = putWarriorOnField(g, "player2");
    const ids = getScytheCycleSplashTargets(g, attacker.instanceId, defender.instanceId).map(
      (w) => w.instanceId,
    );
    expect(ids).toEqual([other.instanceId]);
  });

  it("is empty when the defender is the opponent's only Warrior (splash gate)", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: scythe() });
    const defender = putWarriorOnField(g, "player2");
    expect(getScytheCycleSplashTargets(g, attacker.instanceId, defender.instanceId)).toHaveLength(0);
  });

  it("is empty when the attacker is not equipped with Scythe Cycle", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1");
    const defender = putWarriorOnField(g, "player2");
    putWarriorOnField(g, "player2");
    expect(getScytheCycleSplashTargets(g, attacker.instanceId, defender.instanceId)).toHaveLength(0);
  });
});

describe("getMoiraiExtraAttackTargets", () => {
  const moirai = () => realCard("moirai");

  it("returns the active player's other Warriors when the attacker has Moirai", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: moirai() });
    const ally = putWarriorOnField(g, "player1");
    const ids = getMoiraiExtraAttackTargets(g, attacker.instanceId).map((w) => w.instanceId);
    expect(ids).toEqual([ally.instanceId]);
  });

  it("excludes the attacker itself (cannot grant to itself)", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: moirai() });
    expect(getMoiraiExtraAttackTargets(g, attacker.instanceId)).toHaveLength(0);
  });

  it("is empty when the attacker is not equipped with Moirai", () => {
    const g = newGame();
    const attacker = putWarriorOnField(g, "player1");
    putWarriorOnField(g, "player1");
    expect(getMoiraiExtraAttackTargets(g, attacker.instanceId)).toHaveLength(0);
  });
});

describe("attack action plumbs effectTargetInstanceId through", () => {
  it("Gylippus deals its secondary hit to the chosen second enemy", () => {
    let g = toBattleReady();
    const attacker = putWarriorOnField(g, "player1"); // Monk
    const defender = putWarriorOnField(g, "player2", { currentHealth: 5000, maxHealth: 5000 });
    const second = putWarriorOnField(g, "player2", { currentHealth: 5000, maxHealth: 5000 });
    const card = realCard("gylippus");
    g.players.player1.hand = [card];
    g = mustApply(g, { kind: "enterBattle" });
    g = mustApply(g, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: second.instanceId,
    });
    const sec = g.players.player2.field.find((w) => w.instanceId === second.instanceId);
    expect(sec?.currentHealth).toBe(4000); // 5000 − 1000 secondary
  });

  it("Gylippus with no secondary target leaves the other enemy untouched", () => {
    let g = toBattleReady();
    const attacker = putWarriorOnField(g, "player1");
    const defender = putWarriorOnField(g, "player2", { currentHealth: 5000, maxHealth: 5000 });
    const second = putWarriorOnField(g, "player2", { currentHealth: 5000, maxHealth: 5000 });
    const card = realCard("gylippus");
    g.players.player1.hand = [card];
    g = mustApply(g, { kind: "enterBattle" });
    g = mustApply(g, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      // no effectTargetInstanceId
    });
    const sec = g.players.player2.field.find((w) => w.instanceId === second.instanceId);
    expect(sec?.currentHealth).toBe(5000); // untouched; the flat 2000 still hit the defender
  });

  it("Scythe Cycle splashes the chosen enemy via effectTargetInstanceId", () => {
    let g = toBattleReady();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: realCard("scythe-cycle") });
    const defender = putWarriorOnField(g, "player2", { currentHealth: 9000, maxHealth: 9000 });
    const splash = putWarriorOnField(g, "player2", { currentHealth: 9000, maxHealth: 9000 });
    g = mustApply(g, { kind: "enterBattle" });
    g = mustApply(g, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: splash.instanceId,
    });
    const sp = g.players.player2.field.find((w) => w.instanceId === splash.instanceId);
    expect(sp?.currentHealth).toBe(8500); // 9000 − 500 splash
  });

  it("Moirai grants the chosen friendly an extra attack via effectTargetInstanceId", () => {
    let g = toBattleReady();
    const attacker = putWarriorOnField(g, "player1", { attachedWeapon: realCard("moirai") });
    const ally = putWarriorOnField(g, "player1");
    const defender = putWarriorOnField(g, "player2", { currentHealth: 9000, maxHealth: 9000 });
    g = mustApply(g, { kind: "enterBattle" });
    g = mustApply(g, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: ally.instanceId,
    });
    const a = g.players.player1.field.find((w) => w.instanceId === ally.instanceId);
    expect(a?.attacksRemaining).toBe(2); // 1 + the Moirai grant
  });
});
