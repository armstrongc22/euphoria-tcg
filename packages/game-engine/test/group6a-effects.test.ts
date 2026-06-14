/**
 * Group 6A: GYLIPPUS (Gylippus).
 *
 * A Monk Attack card that deals 2000 flat damage to the Warrior you attack
 * (replacing the normal combat hit, so the damage is independent of the
 * attacker's ATTACK) plus 1000 additional damage to one additional enemy
 * Warrior (effectTargetInstanceId). A missing / invalid / friendly /
 * same-as-defender second target simply skips the additional hit — the 2000
 * still lands.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  defaultEffectRegistry,
  type GameState,
} from "../src/index";
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

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/**
 * Player 1, turn 3: a Monk attacker with Gylippus in hand, facing a primary
 * defender and a second enemy Warrior (the additional target).
 */
function gylippusBattle(
  defenderHealth = 5000,
  secondHealth = 5000,
  attackerOverrides: Parameters<typeof putWarriorOnField>[2] = {},
  secondOverrides: Parameters<typeof putWarriorOnField>[2] = {},
) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", attackerOverrides); // Monk
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: defenderHealth,
    maxHealth: defenderHealth,
  });
  const second = putWarriorOnField(game, "player2", {
    currentHealth: secondHealth,
    maxHealth: secondHealth,
    ...secondOverrides,
  });
  const gylippus = realCard("gylippus");
  game.players.player1.hand.push(gylippus);
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, second, gylippus };
}

function healthOf(game: GameState, instanceId: string): number | undefined {
  return game.players.player2.field.find((w) => w.instanceId === instanceId)
    ?.currentHealth;
}

describe("GYLIPPUS (Gylippus)", () => {
  it("deals 2000 flat to the attacked Warrior and 1000 to one additional enemy", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });

    expect(healthOf(game, defender.instanceId)).toBe(3000); // 5000 - 2000 flat
    expect(healthOf(game, second.instanceId)).toBe(4000); // 5000 - 1000
    // The flat damage replaces the combat hit: no warriorAttacked event.
    expect(game.events.some((e) => e.type === "warriorAttacked")).toBe(false);
  });

  it("deals a flat 2000 regardless of the attacker's ATTACK", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle(
      5000,
      5000,
      { currentAttack: 5000 }, // a much stronger attacker
    );
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });
    expect(healthOf(game, defender.instanceId)).toBe(3000); // still exactly 2000
  });

  it("can destroy the additional target and move it and its Weapon to the Out Deck", () => {
    const weapon = makeWeaponCard();
    let { game, attacker, defender, second, gylippus } = gylippusBattle(
      5000,
      1000,
      {},
      { attachedWeapon: weapon },
    );
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });

    expect(
      game.players.player2.field.some((w) => w.instanceId === second.instanceId),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(second.card.id);
    expect(outDeckIds).toContain(weapon.id);
    expect(healthOf(game, defender.instanceId)).toBe(3000); // defender still -2000
  });

  it("can destroy the attacked Warrior with the flat 2000, Weapon to the Out Deck", () => {
    const weapon = makeWeaponCard();
    let { game, attacker, defender, second, gylippus } = gylippusBattle(
      2000,
      5000,
      {},
    );
    game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!.attachedWeapon = weapon;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });
    expect(
      game.players.player2.field.some((w) => w.instanceId === defender.instanceId),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(defender.card.id);
    expect(outDeckIds).toContain(weapon.id);
    expect(healthOf(game, second.instanceId)).toBe(4000); // additional hit still lands
  });

  it("with no additional target, only the flat 2000 lands", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      // no effectTargetInstanceId
    });
    expect(healthOf(game, defender.instanceId)).toBe(3000); // 2000 flat
    expect(healthOf(game, second.instanceId)).toBe(5000); // untouched
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === gylippus.id,
      ),
    ).toBe(false); // it still resolves
  });

  it("ignores a friendly additional target (no friendly damage)", () => {
    let { game, attacker, defender, gylippus } = gylippusBattle();
    const friendly = putWarriorOnField(game, "player1", {
      currentHealth: 4000,
      maxHealth: 4000,
    });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: friendly.instanceId,
    });
    expect(
      game.players.player1.field.find((w) => w.instanceId === friendly.instanceId)!
        .currentHealth,
    ).toBe(4000); // untouched
    expect(healthOf(game, defender.instanceId)).toBe(3000); // flat 2000 still lands
  });

  it("ignores re-using the attacked Warrior as the additional target (no double hit)", () => {
    let { game, attacker, defender, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: defender.instanceId, // same Warrior
    });
    expect(healthOf(game, defender.instanceId)).toBe(3000); // only the 2000, not 3000 off
  });

  it("ignores an invalid additional target id (flat 2000 only)", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: "no-such-warrior",
    });
    expect(healthOf(game, defender.instanceId)).toBe(3000);
    expect(healthOf(game, second.instanceId)).toBe(5000);
  });

  it("resolved outside an attack context returns EFFECT_FAILED without mutating state", () => {
    const { game, gylippus } = gylippusBattle();
    const resolution = defaultEffectRegistry.resolve(game, gylippus, {
      player: "player1",
    });
    expect(resolution.outcome.resolved).toBe(false);
    expect(resolution.state).toBe(game); // untouched original
  });

  it("does not change the attacker's own health or ATTACK", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });
    const atk = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(atk.currentHealth).toBe(2000); // no counter damage
    expect(atk.currentAttack).toBe(1000); // flat damage, no attacker buff
  });
});
