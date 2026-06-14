/**
 * WEAPON_EQUALIZE_VS_HIGHER_ATTACK (Gilgamesh): when the equipped Warrior
 * attacks a Warrior with higher ATTACK, it gains the difference for the
 * battle, so the hit lands at the higher ATTACK. Against an equal- or
 * lower-ATTACK defender it does nothing. Enforced in computeCombatDamage
 * (actions.ts); equip clears the pending marker.
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

/** Player 1, turn 3: an attacker equipped with Gilgamesh vs a defender. */
function gilgameshDuel(
  attackerAttack: number,
  defenderAttack: number,
  defenderHealth = 9000,
) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    currentAttack: attackerAttack,
  });
  const defender = putWarriorOnField(game, "player2", {
    currentAttack: defenderAttack,
    currentHealth: defenderHealth,
    maxHealth: defenderHealth,
  });
  const weapon = realCard("gilgamesh");
  game.players.player1.hand.push(weapon);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: weapon.id,
    warriorInstanceId: attacker.instanceId,
  });
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, weapon };
}

function damageDealt(attackerAttack: number, defenderAttack: number): number {
  let { game, attacker, defender } = gilgameshDuel(
    attackerAttack,
    defenderAttack,
    9000,
  );
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
  });
  const hit = game.players.player2.field.find(
    (w) => w.instanceId === defender.instanceId,
  )!;
  return 9000 - hit.currentHealth;
}

describe("WEAPON_EQUALIZE_VS_HIGHER_ATTACK (Gilgamesh)", () => {
  it("equip resolves cleanly: no pending marker, no stat change, no statuses", () => {
    const { game, attacker, weapon } = gilgameshDuel(1000, 1000);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000); // unchanged at equip
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
  });

  it("hits at the defender's ATTACK when the defender's ATTACK is higher", () => {
    let { game, attacker, defender } = gilgameshDuel(1000, 3000, 9000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(6000); // 9000 - 3000 (equalized up)
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 3000),
    ).toBe(true);
  });

  it("does nothing when the defender's ATTACK is lower or equal", () => {
    expect(damageDealt(3000, 1000)).toBe(3000); // lower defender: own ATTACK
    expect(damageDealt(2000, 2000)).toBe(2000); // equal: no change
  });

  it("does not raise the equipped Warrior's persistent ATTACK", () => {
    let { game, attacker, defender } = gilgameshDuel(1000, 3000, 9000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000); // the boost is damage-only, this battle
  });

  it("does nothing while the equipped Warrior is defending", () => {
    let { game, attacker, defender } = gilgameshDuel(1000, 5000, 9000);
    // Give the Gilgamesh Warrior a known health, then let the enemy attack it.
    game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!.currentHealth = 4000;
    game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!.maxHealth = 4000;
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId, // 5000 ATTACK, no weapon
      defenderInstanceId: attacker.instanceId, // the Gilgamesh Warrior, lower ATTACK
    });
    // Normal 5000 combat damage to the 4000-HP Warrior: destroyed, no equalize.
    expect(
      game.players.player1.field.some((w) => w.instanceId === attacker.instanceId),
    ).toBe(false);
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 5000),
    ).toBe(true);
  });

  it("a defender's Skeleton Key still halves the equalized damage", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 2
    const defender = putWarriorOnField(game, "player2", {
      currentAttack: 3000,
      currentHealth: 9000,
      maxHealth: 9000,
    });
    const key = realCard("skeleton-key");
    game.players.player2.hand.push(key);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: key.id,
      warriorInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
    const attacker = putWarriorOnField(game, "player1", { currentAttack: 1000 });
    const gil = realCard("gilgamesh");
    game.players.player1.hand.push(gil);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: gil.id,
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
    // Equalized to 3000, then Skeleton Key halves -> 1500.
    expect(hit.currentHealth).toBe(7500);
  });
});
