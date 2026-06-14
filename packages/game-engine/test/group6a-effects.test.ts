/**
 * Group 6A: GYLIPPUS (Gylippus).
 *
 * A Monk Attack card targeting two Warriors: the declared defender takes
 * the attack with +2000 ATTACK (combat hit = attacker_attack + primaryBonus,
 * like Pīsubaipā), and a second, distinct enemy Warrior (effectTargetInstanceId)
 * takes 1000 direct damage. A missing / invalid / friendly second target,
 * or re-using the defender, fails the effect safely — the attack then lands
 * for base damage.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
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
 * defender and a second enemy Warrior (the secondary target).
 */
function gylippusBattle(
  defenderHealth = 5000,
  secondHealth = 5000,
  secondOverrides: Parameters<typeof putWarriorOnField>[2] = {},
) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1"); // Monk, 1000 ATTACK
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
  it("hits the defender for attack+2000 and the second enemy for 1000", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: second.instanceId,
    });

    expect(healthOf(game, defender.instanceId)).toBe(2000); // 5000 - (1000 + 2000)
    expect(healthOf(game, second.instanceId)).toBe(4000); // 5000 - 1000
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 3000),
    ).toBe(true);
  });

  it("can destroy the second target and move it and its Weapon to the Out Deck", () => {
    const weapon = makeWeaponCard();
    let { game, attacker, defender, second, gylippus } = gylippusBattle(5000, 1000, {
      attachedWeapon: weapon,
    });
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
    expect(healthOf(game, defender.instanceId)).toBe(2000); // defender still hit for 3000
  });

  it("fails safely with no second target: attack lands for base damage only", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      // no effectTargetInstanceId
    });

    expect(healthOf(game, defender.instanceId)).toBe(4000); // base 1000, no +2000
    expect(healthOf(game, second.instanceId)).toBe(5000); // untouched
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === gylippus.id,
      ),
    ).toBe(true);
    expect(game.players.player1.outDeck.some((c) => c.id === gylippus.id)).toBe(true);
  });

  it("rejects a friendly second target (effect fails, no friendly damage)", () => {
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
    expect(healthOf(game, defender.instanceId)).toBe(4000); // base damage only
  });

  it("rejects re-using the defender as the second target", () => {
    let { game, attacker, defender, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: defender.instanceId, // same Warrior
    });
    // No +2000 and no extra 1000: just the base combat hit.
    expect(healthOf(game, defender.instanceId)).toBe(4000);
  });

  it("an invalid second target id fails safely (base damage, state intact)", () => {
    let { game, attacker, defender, second, gylippus } = gylippusBattle();
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: gylippus.id,
      effectTargetInstanceId: "no-such-warrior",
    });
    expect(healthOf(game, defender.instanceId)).toBe(4000);
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

  it("does not let Gylippus destroy the attacker or change the attacker's own health", () => {
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
    expect(atk.currentHealth).toBe(2000); // attacker takes no counter damage
    expect(atk.currentAttack).toBe(3000); // 1000 + 2000 buff this turn
  });
});
