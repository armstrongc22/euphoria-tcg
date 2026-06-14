/**
 * Group 6B: DAMAGE_ALL_OPPONENT_WARRIORS_DELAYED (Cytotoxic Chapel).
 *
 * A Sonic Attack card: deals 1500 to every enemy Warrior now (additive with
 * the normal combat hit on the declared defender, like 7th Plague), then a
 * single 500 follow-up tick next turn against the same snapshot of Warriors
 * (survivors only). Friendly Warriors are never touched.
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

function advanceToControllerNextTurn(game: GameState): GameState {
  let g = mustApply(game, { kind: "endTurn" });
  g = mustApply(g, { kind: "endTurn" });
  return g;
}

/**
 * Player 1, turn 3: a Sonic attacker (1000 ATTACK by default) plays
 * Cytotoxic Chapel, declaring the attack against enemy slot `defenderIndex`.
 */
function cytotoxicPlay(
  enemies: Parameters<typeof putWarriorOnField>[2][],
  defenderIndex = 0,
  attackerAttack = 1000,
) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    card: makeWarriorCard({ faction: "Sonic" }),
    currentAttack: attackerAttack,
  });
  const enemyWarriors = enemies.map((o) => putWarriorOnField(game, "player2", o));
  const card = realCard("cytotoxic-chapel");
  game.players.player1.hand.push(card);
  game = mustApply(game, { kind: "enterBattle" });
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: enemyWarriors[defenderIndex]!.instanceId,
    selectedAttackCardId: card.id,
  });
  return { game, attacker, enemyWarriors, card };
}

function healthOf(game: GameState, instanceId: string): number | undefined {
  return game.players.player2.field.find((w) => w.instanceId === instanceId)
    ?.currentHealth;
}

describe("DAMAGE_ALL_OPPONENT_WARRIORS_DELAYED (Cytotoxic Chapel)", () => {
  it("resolves with no pending marker", () => {
    const { game, card } = cytotoxicPlay([{ currentHealth: 9000, maxHealth: 9000 }]);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
  });

  it("deals 1500 to every enemy now, additive with the combat hit on the defender", () => {
    const { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 }, // defender
      { currentHealth: 5000, maxHealth: 5000 }, // bystander
    ]);
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6500); // 9000 - 1500 - 1000 combat
    expect(healthOf(game, enemyWarriors[1]!.instanceId)).toBe(3500); // 5000 - 1500
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 1000),
    ).toBe(true);
  });

  it("deals the 500 follow-up tick on the controller's next turn, once", () => {
    let { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 },
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    game = advanceToControllerNextTurn(game); // player1 turn 5
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6000); // 6500 - 500
    expect(healthOf(game, enemyWarriors[1]!.instanceId)).toBe(3000); // 3500 - 500

    game = advanceToControllerNextTurn(game); // player1 turn 7 — no more ticks
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6000);
    expect(healthOf(game, enemyWarriors[1]!.instanceId)).toBe(3000);
    expect(game.players.player1.delayedEffects).toHaveLength(0);
  });

  it("does not tick on the opponent's turn", () => {
    let { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 },
    ]);
    game = mustApply(game, { kind: "endTurn" }); // player2 turn 4
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6500); // unchanged
  });

  it("destroys a lethally-hit enemy now and moves it and its Weapon to the Out Deck", () => {
    const weapon = makeWeaponCard();
    const { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 }, // defender survives
      { currentHealth: 1000, maxHealth: 1000, attachedWeapon: weapon }, // dies to AoE
    ]);
    expect(
      game.players.player2.field.some(
        (w) => w.instanceId === enemyWarriors[1]!.instanceId,
      ),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(enemyWarriors[1]!.card.id);
    expect(outDeckIds).toContain(weapon.id);
  });

  it("the follow-up skips a Warrior destroyed by the initial AoE (no crash)", () => {
    let { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 },
      { currentHealth: 1000, maxHealth: 1000 }, // dies to AoE now
    ]);
    game = advanceToControllerNextTurn(game); // player1 turn 5 — follow-up
    expect(
      game.players.player2.field.some(
        (w) => w.instanceId === enemyWarriors[1]!.instanceId,
      ),
    ).toBe(false);
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6000); // 6500 - 500
  });

  it("the follow-up only hits the snapshot, not Warriors summoned later", () => {
    let { game, enemyWarriors } = cytotoxicPlay([
      { currentHealth: 9000, maxHealth: 9000 },
    ]);
    game = mustApply(game, { kind: "endTurn" }); // player2 turn 4
    const newcomer = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "endTurn" }); // player1 turn 5 — follow-up
    expect(healthOf(game, enemyWarriors[0]!.instanceId)).toBe(6000);
    expect(healthOf(game, newcomer.instanceId)).toBe(5000); // untouched
  });

  it("never damages the controller's own Warriors", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Sonic" }),
    });
    const friendly = putWarriorOnField(game, "player1", {
      currentHealth: 4000,
      maxHealth: 4000,
    });
    const enemy = putWarriorOnField(game, "player2", {
      currentHealth: 9000,
      maxHealth: 9000,
    });
    const card = realCard("cytotoxic-chapel");
    game.players.player1.hand.push(card);
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: enemy.instanceId,
      selectedAttackCardId: card.id,
    });
    game = advanceToControllerNextTurn(game); // through the follow-up tick
    expect(
      game.players.player1.field.find((w) => w.instanceId === friendly.instanceId)!
        .currentHealth,
    ).toBe(4000);
  });
});
