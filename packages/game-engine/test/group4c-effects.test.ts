/**
 * Group 4C: Weapon combat passives — WEAPON_HALVE_INCOMING_DAMAGE
 * (Skeleton Key) and WEAPON_ADD_ATTACK_DIFFERENCE_DAMAGE (Xīwànghǎo),
 * read from the attached Weapon during damage calculation. Also verifies
 * WEAPON_ATTACK_BONUS_SPLASH (Scythe Cycle) stays safely unimplemented.
 */
import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

/**
 * Player 2 equips Skeleton Key on a 5000-health Warrior during their
 * turn 2; player 1 fields an attacker and enters Battle Phase on turn 3.
 */
function skeletonKeyDuel() {
  let game = newGame();
  game = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: 5000,
    maxHealth: 5000,
  });
  const bystander = putWarriorOnField(game, "player2");
  const key = realCard("skeleton-key");
  game.players.player2.hand.push(key);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: key.id,
    warriorInstanceId: defender.instanceId,
  });
  game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
  const attacker = putWarriorOnField(game, "player1");
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, bystander, key };
}

describe("WEAPON_HALVE_INCOMING_DAMAGE (Skeleton Key)", () => {
  it("equip resolves cleanly: no pending marker, no stat or status changes", () => {
    const { game, defender, key } = skeletonKeyDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === key.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const equipped = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000);
    expect(equipped.attachedWeapon?.id).toBe(key.id);
  });

  it("halves incoming combat damage while attached, defending", () => {
    let { game, attacker, defender } = skeletonKeyDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(4500); // 5000 - floor(1000 * 0.5)
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 500),
    ).toBe(true);
  });

  it("does not reduce the equipped Warrior's own outgoing damage when attacking", () => {
    let { game, attacker, defender } = skeletonKeyDuel();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId, // equipped Warrior attacks
      defenderInstanceId: attacker.instanceId,
    });

    const hit = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(hit.currentHealth).toBe(1000); // full 1000 damage taken
  });

  it("does not protect unequipped Warriors", () => {
    let { game, attacker, bystander } = skeletonKeyDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: bystander.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(hit.currentHealth).toBe(1000); // full 1000 damage
  });

  it("stops applying when the Warrior dies; the Weapon goes to the Out Deck with it", () => {
    let { game, defender, key } = skeletonKeyDuel();
    const heavy = putWarriorOnField(game, "player1", { currentAttack: 10000 });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: heavy.instanceId,
      defenderInstanceId: defender.instanceId, // halved to 5000: exactly lethal
    });

    expect(
      game.players.player2.field.some((w) => w.instanceId === defender.instanceId),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(defender.card.id);
    expect(outDeckIds).toContain(key.id);
  });

  it("existing equip rules still hold: no second Weapon on the same Warrior", () => {
    const { game, defender } = skeletonKeyDuel();
    const second = makeWeaponCard();
    game.players.player2.hand.push(second);
    // Not player2's turn (battle phase of player1's turn 3); validate the
    // rule on a fresh main-phase state instead.
    let p2Turn = mustApply(game, { kind: "endTurn" });
    p2Turn.players.player2.spirit = 5;
    const result = applyAction(p2Turn, {
      kind: "equipWeapon",
      cardId: second.id,
      warriorInstanceId: defender.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WEAPON_ALREADY_EQUIPPED");
  });
});

describe("WEAPON_ADD_ATTACK_DIFFERENCE_DAMAGE (Xīwànghǎo)", () => {
  /**
   * Player 1 equips Xīwànghǎo on a 1000-attack Warrior on turn 3 and
   * faces a 3000-attack, 5000-health defender.
   */
  function xiwanghaoDuel() {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3 (3 Spirit)
    const attacker = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentAttack: 3000,
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const weapon = realCard("xiwanghao");
    game.players.player1.hand.push(weapon);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: attacker.instanceId,
    });
    return { game, attacker, defender, weapon };
  }

  it("equip resolves cleanly with no immediate stat change", () => {
    const { game, attacker, weapon } = xiwanghaoDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(false);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000);
  });

  it("adds the attack difference to the equipped Warrior's outgoing damage", () => {
    let { game, attacker, defender } = xiwanghaoDuel();
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(2000); // 5000 - (1000 + |1000 - 3000|)
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 3000),
    ).toBe(true);
  });

  it("does nothing while the equipped Warrior is defending", () => {
    let { game, attacker, defender } = xiwanghaoDuel();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId, // 3000 attack
      defenderInstanceId: attacker.instanceId, // equipped, 2000 health
    });

    // Full 3000 damage, no halving, no difference math: lethal.
    expect(
      game.players.player1.field.some((w) => w.instanceId === attacker.instanceId),
    ).toBe(false);
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 3000),
    ).toBe(true);
  });

  it("stacks with the defender's Skeleton Key: difference added, then halved", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 2
    const defender = putWarriorOnField(game, "player2", {
      currentAttack: 3000,
      currentHealth: 5000,
      maxHealth: 5000,
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
    const weapon = realCard("xiwanghao");
    game.players.player1.hand.push(weapon);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
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
    expect(hit.currentHealth).toBe(3500); // floor((1000 + 2000) * 0.5) = 1500
  });
});

describe("WEAPON_ATTACK_BONUS_SPLASH (Scythe Cycle) stays unimplemented", () => {
  it("equips with the pending marker, no stat change, no statuses", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
    const warrior = putWarriorOnField(game, "player1");
    const scythe = realCard("scythe-cycle");
    game.players.player1.hand.push(scythe);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: scythe.id,
      warriorInstanceId: warrior.instanceId,
    });

    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === scythe.id,
      ),
    ).toBe(true);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === warrior.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000); // no +500: effect fully pending
    expect(equipped.attachedWeapon?.id).toBe(scythe.id);
    expect(game.statuses).toHaveLength(0);
  });
});
