/**
 * WEAPON_ATTACK_BONUS_LEAVE_AT_ONE (Jesus): the equipped Warrior gains 1000
 * ATTACK (static, at equip), and a Warrior it attacks cannot be destroyed by
 * that battle — a lethal hit leaves the defender's HEALTH at 1 instead. The
 * +ATTACK is applied at equip; the non-lethal clamp is a combat hook in
 * attackWarrior (actions.ts) keyed on the attacker's attached Weapon.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/** Player 1, turn 3: an attacker equipped with Jesus vs a defender. */
function jesusDuel(defenderHealth = 5000, attackerBaseAttack = 1000) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    currentAttack: attackerBaseAttack,
  });
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: defenderHealth,
    maxHealth: defenderHealth,
  });
  const weapon = realCard("jesus");
  game.players.player1.hand.push(weapon);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: weapon.id,
    warriorInstanceId: attacker.instanceId,
  });
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, weapon };
}

describe("WEAPON_ATTACK_BONUS_LEAVE_AT_ONE (Jesus)", () => {
  it("grants +1000 ATTACK at equip with no pending marker", () => {
    const { game, attacker, weapon } = jesusDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(false);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(2000); // 1000 + 1000
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
  });

  it("leaves a lethally-hit defender at 1 HEALTH instead of destroying it", () => {
    let { game, attacker, defender } = jesusDuel(1500); // 2000 dmg would be lethal
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(1); // clamped, not destroyed
    expect(game.players.player2.outDeck).toHaveLength(0);
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 2000),
    ).toBe(true);
  });

  it("deals normal damage when the hit is not lethal", () => {
    let { game, attacker, defender } = jesusDuel(5000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(
      game.players.player2.field.find((w) => w.instanceId === defender.instanceId)!
        .currentHealth,
    ).toBe(3000); // 5000 - 2000, no clamp
  });

  it("cannot finish off a defender already at 1 HEALTH", () => {
    let { game, attacker, defender } = jesusDuel(1);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(
      game.players.player2.field.some((w) => w.instanceId === defender.instanceId),
    ).toBe(true);
    expect(
      game.players.player2.field.find((w) => w.instanceId === defender.instanceId)!
        .currentHealth,
    ).toBe(1);
  });

  it("keeps a clamped defender's attached Weapon in play (not in the Out Deck)", () => {
    let { game, attacker, defender } = jesusDuel(1500);
    const enemyWeapon = makeWeaponCard(); // plain Weapon, no damage reduction
    game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!.attachedWeapon = enemyWeapon;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    // 2000 would be lethal but is clamped to 1; the Warrior and its Weapon stay.
    expect(hit.currentHealth).toBe(1);
    expect(hit.attachedWeapon?.id).toBe(enemyWeapon.id);
    expect(game.players.player2.outDeck).toHaveLength(0);
  });

  it("clamps attack-card-boosted hits too (Jesus +1000 plus an Attack card)", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 3000,
      maxHealth: 3000,
    });
    const jesus = realCard("jesus");
    game.players.player1.hand.push(jesus);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: jesus.id,
      warriorInstanceId: attacker.instanceId,
    }); // currentAttack now 1500 (500 + 1000)
    const oak = realCard("oak-splitter-5x"); // Dwarf Attack: +2000
    game.players.player1.hand.push(oak);
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: oak.id,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    // 1500 + 2000 = 3500 would be lethal vs 3000 HP; clamped to 1.
    expect(hit.currentHealth).toBe(1);
    expect(game.players.player2.outDeck).toHaveLength(0);
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 3500),
    ).toBe(true);
  });

  it("does not protect the equipped Warrior while it is defending", () => {
    let game = toPlayer1Turn3(newGame());
    const jesusWarrior = putWarriorOnField(game, "player1", {
      currentHealth: 1500,
      maxHealth: 1500,
    });
    const enemy = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const weapon = realCard("jesus");
    game.players.player1.hand.push(weapon);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: jesusWarrior.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId, // no Jesus
      defenderInstanceId: jesusWarrior.instanceId,
    });
    // 5000 damage destroys the 1500-HP Jesus Warrior — the clamp is
    // attacker-side and does nothing while it defends.
    expect(
      game.players.player1.field.some((w) => w.instanceId === jesusWarrior.instanceId),
    ).toBe(false);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(weapon.id);
  });
});
