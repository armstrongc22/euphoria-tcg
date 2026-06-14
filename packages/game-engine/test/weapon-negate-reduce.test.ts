/**
 * WEAPON_NEGATE_ONCE_REDUCE_ATTACKER (Ontology): the equipped Warrior
 * negates the first attack against it each turn (takes no damage), and any
 * Warrior that attacks it loses 500 ATTACK. Both clauses are defender-side
 * and independent — a negated attack still debuffs the attacker. Enforced in
 * attackWarrior (actions.ts); equip clears the pending marker.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import { makeDecks, mustApply, putWarriorOnField, realCard } from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

/**
 * Player 2 equips Ontology on a Warrior during turn 2; player 1 fields an
 * attacker and enters Battle Phase on turn 3.
 */
function ontologyDuel(attackerAttack = 2000, equippedHealth = 5000) {
  let game = newGame();
  game = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  const equipped = putWarriorOnField(game, "player2", {
    currentHealth: equippedHealth,
    maxHealth: equippedHealth,
  });
  const ont = realCard("ontology");
  game.players.player2.hand.push(ont);
  game = mustApply(game, {
    kind: "equipWeapon",
    cardId: ont.id,
    warriorInstanceId: equipped.instanceId,
  });
  game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
  const attacker = putWarriorOnField(game, "player1", {
    currentAttack: attackerAttack,
  });
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, equipped, ont };
}

function equippedHealthOf(game: GameState, instanceId: string): number | undefined {
  return game.players.player2.field.find((w) => w.instanceId === instanceId)
    ?.currentHealth;
}

function attackerAttackOf(game: GameState, instanceId: string): number | undefined {
  return game.players.player1.field.find((w) => w.instanceId === instanceId)
    ?.currentAttack;
}

describe("WEAPON_NEGATE_ONCE_REDUCE_ATTACKER (Ontology)", () => {
  it("equip resolves cleanly: no pending marker, no stat change, no statuses", () => {
    const { game, equipped, ont } = ontologyDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === ont.id,
      ),
    ).toBe(false);
    expect(game.statuses).toHaveLength(0);
    const w = game.players.player2.field.find(
      (x) => x.instanceId === equipped.instanceId,
    )!;
    expect(w.currentAttack).toBe(1000); // default, unchanged
    expect(w.attachedWeapon?.id).toBe(ont.id);
  });

  it("negates the first attack each turn and debuffs the attacker by 500", () => {
    let { game, attacker, equipped } = ontologyDuel(2000, 5000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: equipped.instanceId,
    });
    expect(equippedHealthOf(game, equipped.instanceId)).toBe(5000); // negated, no damage
    expect(attackerAttackOf(game, attacker.instanceId)).toBe(1500); // 2000 - 500
    expect(
      game.events.some(
        (e) => e.type === "attackNegated" && e.instanceId === equipped.instanceId,
      ),
    ).toBe(true);
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 0),
    ).toBe(true);
  });

  it("only negates one attack per turn; a second attacker hits normally (still debuffed)", () => {
    let { game, attacker, equipped } = ontologyDuel(2000, 5000);
    const attacker2 = putWarriorOnField(game, "player1", { currentAttack: 2000 });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: equipped.instanceId,
    }); // negated
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker2.instanceId,
      defenderInstanceId: equipped.instanceId,
    }); // not negated

    expect(equippedHealthOf(game, equipped.instanceId)).toBe(3000); // 5000 - 2000
    expect(attackerAttackOf(game, attacker.instanceId)).toBe(1500); // both debuffed
    expect(attackerAttackOf(game, attacker2.instanceId)).toBe(1500);
    expect(
      game.events.filter((e) => e.type === "attackNegated"),
    ).toHaveLength(1);
  });

  it("refreshes the negation on a later turn", () => {
    let { game, attacker, equipped } = ontologyDuel(2000, 5000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: equipped.instanceId,
    }); // turn 3: negated, attacker 2000 -> 1500
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: equipped.instanceId,
    }); // turn 5: negated again, attacker 1500 -> 1000

    expect(equippedHealthOf(game, equipped.instanceId)).toBe(5000); // still unscathed
    expect(attackerAttackOf(game, attacker.instanceId)).toBe(1000);
    expect(game.events.filter((e) => e.type === "attackNegated")).toHaveLength(2);
  });

  it("floors the attacker's ATTACK at 0, never negative", () => {
    let { game, attacker, equipped } = ontologyDuel(300, 5000);
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: equipped.instanceId,
    });
    expect(attackerAttackOf(game, attacker.instanceId)).toBe(0); // 300 - 500 -> 0
  });

  it("is defender-side only: the equipped Warrior attacking is unaffected", () => {
    let { game, equipped } = ontologyDuel(2000, 5000);
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    const victim = putWarriorOnField(game, "player1", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: equipped.instanceId, // the Ontology Warrior attacks
      defenderInstanceId: victim.instanceId,
    });
    // Normal 1000 damage; no negation, and the Ontology Warrior keeps its ATTACK.
    expect(
      game.players.player1.field.find((w) => w.instanceId === victim.instanceId)!
        .currentHealth,
    ).toBe(4000);
    expect(
      game.players.player2.field.find((w) => w.instanceId === equipped.instanceId)!
        .currentAttack,
    ).toBe(1000);
    expect(game.events.some((e) => e.type === "attackNegated")).toBe(false);
  });
});
