/**
 * WEAPON_HALF_HEALTH_DAMAGE (Apotheosis): the damage a Warrior equipped
 * with this card inflicts is always half the defender's current HEALTH,
 * replacing the attack-based amount. Enforced in computeCombatDamage
 * (actions.ts); equip just clears the pending marker.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import { makeDecks, mustApply, putWarriorOnField, realCard } from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/** Player 1, turn 3: an attacker equipped with Apotheosis vs a defender. */
function apotheosisDuel(attackerAttack = 1000, defenderHealth = 5000) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    currentAttack: attackerAttack,
  });
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: defenderHealth,
    maxHealth: defenderHealth,
  });
  const weapon = realCard("apotheosis");
  game.players.player1.hand.push(weapon);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: weapon.id,
    warriorInstanceId: attacker.instanceId,
  });
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, weapon };
}

function defenderHealthAfterAttack(
  attackerAttack: number,
  defenderHealth: number,
): number {
  let { game, attacker, defender } = apotheosisDuel(attackerAttack, defenderHealth);
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
  });
  return game.players.player2.field.find((w) => w.instanceId === defender.instanceId)!
    .currentHealth;
}

describe("WEAPON_HALF_HEALTH_DAMAGE (Apotheosis)", () => {
  it("equip resolves cleanly: no pending marker, no stat change, no statuses", () => {
    const { game, attacker, weapon } = apotheosisDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000); // unchanged
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
  });

  it("deals half the defender's current HEALTH as damage", () => {
    let { game, attacker, defender } = apotheosisDuel(1000, 5000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(2500); // 5000 - floor(5000 * 0.5)
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 2500),
    ).toBe(true);
  });

  it("is independent of the attacker's ATTACK (weak or strong)", () => {
    expect(defenderHealthAfterAttack(100, 4000)).toBe(2000); // half, not 100
    expect(defenderHealthAfterAttack(10000, 4000)).toBe(2000); // half, not 10000
  });

  it("recomputes from the defender's CURRENT health, not its max", () => {
    let { game, attacker, defender } = apotheosisDuel(1000, 5000);
    // Pre-damage the defender to 2000/5000.
    game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!.currentHealth = 2000;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(
      game.players.player2.field.find((w) => w.instanceId === defender.instanceId)!
        .currentHealth,
    ).toBe(1000); // 2000 - floor(2000 * 0.5)
  });

  it("never destroys the defender by itself (always leaves ~half)", () => {
    // A 10000-ATTACK attacker would normally kill a 3000-HP defender.
    let { game, attacker, defender } = apotheosisDuel(10000, 3000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(1500); // 3000 - 1500, survives
  });

  it("does nothing while the equipped Warrior is defending", () => {
    let { game, attacker, defender } = apotheosisDuel(1000, 5000);
    // Give the Apotheosis Warrior a known health, then let the enemy attack it.
    game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!.currentHealth = 3000;
    game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!.maxHealth = 3000;
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId, // 1000 ATTACK, no weapon
      defenderInstanceId: attacker.instanceId, // the Apotheosis Warrior
    });
    const hit = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(hit.currentHealth).toBe(2000); // normal 1000, not floor(3000 * 0.5) = 1500
  });

  it("a defender's Skeleton Key still halves the inflicted half-health damage", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 2
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 8000,
      maxHealth: 8000,
    });
    const key = realCard("skeleton-key");
    game.players.player2.hand.push(key);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: key.id,
      warriorInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
    const attacker = putWarriorOnField(game, "player1");
    const apo = realCard("apotheosis");
    game.players.player1.hand.push(apo);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: apo.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    // floor(8000 * 0.5) = 4000, then Skeleton Key halves -> 2000.
    expect(hit.currentHealth).toBe(6000);
  });
});
