/**
 * Group 4D: simple Weapon combat passives enforced in actions.ts.
 *
 * - WEAPON_DISABLE_ATTACKED_ONE_TURN (Phobos): a Warrior attacked by the
 *   equipped Warrior can't attack for 1 turn (rides DISABLE_WARRIOR_ATTACKS).
 * - WEAPON_ATTACK_PER_DESTROYED_FRIENDLY (Armageddon): the equipped
 *   Warrior's outgoing damage gains a per-destroyed-friendly-Warrior bonus,
 *   recomputed each attack from the controller's Out Deck.
 *
 * (Moirai / WEAPON_GRANT_OTHER_EXTRA_ATTACK is covered in Group 4E.)
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameState,
} from "../src/index";
import {
  makeDecks,
  makeItemCard,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

/** Advance to player 1's turn 3 (3 Spirit, attacks allowed), in Main Phase. */
function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

describe("WEAPON_DISABLE_ATTACKED_ONE_TURN (Phobos)", () => {
  /**
   * Player 1 equips Phobos on an attacker on turn 3 and faces a tanky
   * defender (survives the hit, so the disable lands) plus a bystander.
   */
  function phobosDuel() {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const bystander = putWarriorOnField(game, "player2");
    const phobos = realCard("phobos");
    game.players.player1.hand.push(phobos);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: phobos.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    return { game, attacker, defender, bystander, phobos };
  }

  it("equip resolves cleanly: no pending marker, no statuses", () => {
    const { game, attacker, phobos } = phobosDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === phobos.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1000);
    expect(equipped.attachedWeapon?.id).toBe(phobos.id);
  });

  it("applies the disable to the attacked defender (and only it)", () => {
    let { game, attacker, defender, bystander } = phobosDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const disables = game.statuses.filter(
      (s) => s.code === "DISABLE_WARRIOR_ATTACKS",
    );
    expect(disables).toHaveLength(1);
    const disable = disables[0]!;
    expect(disable.affectedInstanceId).toBe(defender.instanceId);
    expect(disable.affectedPlayer).toBe("player2");
    expect(disable.expiry.player).toBe("player2");
    expect(disable.expiry.timing).toBe("startOfTurn");
    expect(disable.expiry.turnsRemaining).toBe(1);
    expect(disable.affectedInstanceId).not.toBe(bystander.instanceId);
  });

  it("the disabled Warrior cannot attack on its next turn", () => {
    let { game, attacker, defender } = phobosDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4 — disable fires
    game = mustApply(game, { kind: "enterBattle" });
    const blocked = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("WARRIOR_EXHAUSTED");

    const legalAttackers = getLegalActions(game)
      .filter((a) => a.kind === "attack")
      .map((a) => (a.kind === "attack" ? a.attackerInstanceId : ""));
    expect(legalAttackers).not.toContain(defender.instanceId);
  });

  it("unrelated Warriors can still attack while the defender is disabled", () => {
    let { game, attacker, defender, bystander } = phobosDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });

    const legalAttackers = getLegalActions(game)
      .filter((a) => a.kind === "attack")
      .map((a) => (a.kind === "attack" ? a.attackerInstanceId : ""));
    expect(legalAttackers).toContain(bystander.instanceId);

    const ok = applyAction(game, {
      kind: "attack",
      attackerInstanceId: bystander.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(ok.ok).toBe(true);
  });

  it("the disable expires: the Warrior can attack again the turn after", () => {
    let { game, attacker, defender } = phobosDuel();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4 — disable fires & clears
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5
    expect(
      game.statuses.some((s) => s.code === "DISABLE_WARRIOR_ATTACKS"),
    ).toBe(false);
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 6
    game = mustApply(game, { kind: "enterBattle" });
    const freed = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(freed.ok).toBe(true);
  });

  it("does not apply the passive when the Weapon is unattached", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // no Phobos
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(
      game.statuses.some((s) => s.code === "DISABLE_WARRIOR_ATTACKS"),
    ).toBe(false);
  });

  it("stops applying once the equipped Warrior dies and the Weapon moves to the Out Deck", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // 2000 health
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const killer = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const phobos = realCard("phobos");
    game.players.player1.hand.push(phobos);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: phobos.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
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
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(phobos.id);

    // Player 1, turn 5: a fresh, unequipped Warrior attacks — no disable.
    game = mustApply(game, { kind: "endTurn" });
    const rookie = putWarriorOnField(game, "player1");
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: rookie.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(
      game.statuses.some((s) => s.code === "DISABLE_WARRIOR_ATTACKS"),
    ).toBe(false);
  });

  it("a direct attack does not trigger the defender-specific disable", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // opponent has no Warriors
    const phobos = realCard("phobos");
    game.players.player1.hand.push(phobos);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: phobos.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(
      game.statuses.some((s) => s.code === "DISABLE_WARRIOR_ATTACKS"),
    ).toBe(false);
    expect(game.players.player2.lives).toBe(2);
  });
});

describe("WEAPON_ATTACK_PER_DESTROYED_FRIENDLY (Armageddon)", () => {
  /**
   * Player 1 equips Armageddon on a 1000-attack Warrior on turn 3, with
   * `destroyed` destroyed friendly Warriors already in the Out Deck.
   */
  function armageddonDuel(destroyed: number) {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const weapon = realCard("armageddon");
    game.players.player1.hand.push(weapon);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: attacker.instanceId,
    });
    for (let i = 0; i < destroyed; i++) {
      game.players.player1.outDeck.push(makeWarriorCard());
    }
    game = mustApply(game, { kind: "enterBattle" });
    return { game, attacker, defender, weapon };
  }

  it("equip resolves cleanly with no immediate stat change", () => {
    const { game, attacker, weapon } = armageddonDuel(0);
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

  it("adds 250 outgoing damage per destroyed friendly Warrior", () => {
    let { game, attacker, defender } = armageddonDuel(2);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(3500); // 5000 - (1000 + 250 * 2)
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 1500),
    ).toBe(true);
  });

  it("counts only destroyed Warriors, not Items, in the Out Deck", () => {
    let { game, attacker, defender } = armageddonDuel(1);
    game.players.player1.outDeck.push(makeItemCard(), makeItemCard());
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(3750); // 5000 - (1000 + 250 * 1)
  });

  it("adds no bonus when no friendly Warriors have been destroyed", () => {
    let { game, attacker, defender } = armageddonDuel(0);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const hit = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hit.currentHealth).toBe(4000); // 5000 - 1000, no bonus
  });
});
