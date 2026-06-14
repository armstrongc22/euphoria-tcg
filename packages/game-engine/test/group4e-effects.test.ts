/**
 * Group 4E: WEAPON_GRANT_OTHER_EXTRA_ATTACK (Moirai). When the equipped
 * Warrior makes a Warrior-vs-Warrior attack, it may grant one *other*
 * friendly Warrior an extra attack this turn. The choice rides the
 * attack's effectTargetInstanceId; the grant uses the shared
 * attacksRemaining plumbing (cf. EXTRA_ATTACK_THIS_TURN), so it lapses at
 * the next refresh. The equipped Warrior can never target itself, and
 * missing / invalid / enemy targets grant nothing without failing the
 * attack.
 */
import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameState } from "../src/index";
import { makeDecks, mustApply, putWarriorOnField, realCard } from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/**
 * Player 1, turn 3: an attacker equipped with Moirai, a friendly bystander,
 * and a tanky enemy defender that survives the hit. `defenders` adds extra
 * enemy Warriors (all 5000 health) for multi-attack scenarios.
 */
function moiraiDuel(extraDefenders = 0) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1");
  const bystander = putWarriorOnField(game, "player1");
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: 5000,
    maxHealth: 5000,
  });
  const moreDefenders = Array.from({ length: extraDefenders }, () =>
    putWarriorOnField(game, "player2", { currentHealth: 5000, maxHealth: 5000 }),
  );
  const moirai = realCard("moirai");
  game.players.player1.hand.push(moirai);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: moirai.id,
    warriorInstanceId: attacker.instanceId,
  });
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, bystander, defender, moreDefenders, moirai };
}

describe("WEAPON_GRANT_OTHER_EXTRA_ATTACK (Moirai)", () => {
  it("equip resolves cleanly: no pending marker, no statuses", () => {
    const { game, attacker, moirai } = moiraiDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === moirai.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000);
    expect(equipped.attachedWeapon?.id).toBe(moirai.id);
  });

  it("grants another friendly Warrior +1 attack when the equipped Warrior attacks", () => {
    let { game, attacker, bystander, defender } = moiraiDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });

    const granted = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(granted.attacksRemaining).toBe(2); // 1 base + 1 granted
    expect(
      game.events.some(
        (e) => e.type === "extraAttackGranted" && e.instanceId === bystander.instanceId,
      ),
    ).toBe(true);
  });

  it("the selected friendly Warrior can attack twice that turn", () => {
    let { game, attacker, bystander, defender, moreDefenders } = moiraiDuel(1);
    const defender2 = moreDefenders[0]!;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });
    const first = applyAction(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyAction(first.state, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender2.instanceId,
    });
    expect(second.ok).toBe(true);
  });

  it("the selected Warrior cannot exceed the granted extra attack", () => {
    let { game, attacker, bystander, defender, moreDefenders } = moiraiDuel(1);
    const defender2 = moreDefenders[0]!;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender2.instanceId,
    });
    const third = applyAction(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("WARRIOR_EXHAUSTED");
  });

  it("the equipped Warrior cannot grant the extra attack to itself", () => {
    let { game, attacker, defender } = moiraiDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: attacker.instanceId, // self — not allowed
    });

    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.attacksRemaining).toBe(0); // only the attack it spent
    expect(game.events.some((e) => e.type === "extraAttackGranted")).toBe(false);
  });

  it("an enemy Warrior cannot be selected", () => {
    let { game, attacker, defender } = moiraiDuel(1);
    const enemy2 = game.players.player2.field[1]!; // a second enemy Warrior
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: enemy2.instanceId,
    });

    const stillEnemy = game.players.player2.field.find(
      (w) => w.instanceId === enemy2.instanceId,
    )!;
    expect(stillEnemy.attacksRemaining).toBe(1); // untouched
    expect(game.events.some((e) => e.type === "extraAttackGranted")).toBe(false);
  });

  it("a missing target is rejected safely (attack still resolves, no grant)", () => {
    let { game, attacker, bystander, defender } = moiraiDuel();
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      // no effectTargetInstanceId
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const granted = result.state.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(granted.attacksRemaining).toBe(1);
    const hit = result.state.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(4000); // attack resolved normally
  });

  it("an invalid target is rejected safely", () => {
    let { game, attacker, bystander, defender } = moiraiDuel();
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: "no-such-warrior",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const granted = result.state.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(granted.attacksRemaining).toBe(1);
    expect(
      result.state.events.some((e) => e.type === "extraAttackGranted"),
    ).toBe(false);
  });

  it("a direct attack does not trigger the grant", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1");
    const bystander = putWarriorOnField(game, "player1"); // opponent has no Warriors
    const moirai = realCard("moirai");
    game.players.player1.hand.push(moirai);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: moirai.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    const stander = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(stander.attacksRemaining).toBe(1);
    expect(game.events.some((e) => e.type === "extraAttackGranted")).toBe(false);
    expect(game.players.player2.lives).toBe(2);
  });

  it("does not apply when the Weapon is unattached", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // no Moirai
    const bystander = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });

    const stander = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(stander.attacksRemaining).toBe(1);
    expect(game.events.some((e) => e.type === "extraAttackGranted")).toBe(false);
  });

  it("stops applying once the equipped Warrior dies and the Weapon moves to the Out Deck", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // 2000 health
    const bystander = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const killer = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const moirai = realCard("moirai");
    game.players.player1.hand.push(moirai);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: moirai.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });

    // Player 2, turn 4: the killer destroys the equipped Warrior.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: killer.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(
      game.players.player1.field.some((w) => w.instanceId === attacker.instanceId),
    ).toBe(false);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(moirai.id);

    // Player 1, turn 5: the surviving bystander (unequipped) attacks — no grant.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    const before = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!.attacksRemaining;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });
    expect(before).toBe(1);
    const after = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!.attacksRemaining;
    expect(after).toBe(0); // spent its one attack, no extra granted
  });

  it("the granted extra attack expires at the next turn refresh", () => {
    let { game, attacker, bystander, defender } = moiraiDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });
    // Grant landed but went unused this turn.
    expect(
      game.players.player1.field.find((w) => w.instanceId === bystander.instanceId)!
        .attacksRemaining,
    ).toBe(2);

    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5 — refresh
    expect(
      game.players.player1.field.find((w) => w.instanceId === bystander.instanceId)!
        .attacksRemaining,
    ).toBe(1); // back to a single attack
  });

  it("the once-per-turn direct attack limit still holds for a granted Warrior", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1");
    const bystander = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 1000,
      maxHealth: 1000,
    }); // dies to the 1000-attack hit
    const moirai = realCard("moirai");
    game.players.player1.hand.push(moirai);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: moirai.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    // Equipped attack destroys the lone defender and grants the bystander +1.
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: bystander.instanceId,
    });
    expect(
      game.players.player1.field.find((w) => w.instanceId === bystander.instanceId)!
        .attacksRemaining,
    ).toBe(2);
    expect(game.players.player2.field).toHaveLength(0);

    // The bystander has 2 attacks but only 1 direct attack is allowed.
    game = mustApply(game, {
      kind: "directAttack",
      attackerInstanceId: bystander.instanceId,
    });
    expect(game.players.player2.lives).toBe(2);
    const second = applyAction(game, {
      kind: "directAttack",
      attackerInstanceId: bystander.instanceId,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("DIRECT_ATTACK_LIMIT");
  });
});
