/**
 * TANK_FORM (XL-QR517).
 *
 * A Neutral Item: a friendly Warrior climbs into the tank, taking on the
 * tank's 1500 ATTACK / 3100 HEALTH. When the tank is destroyed the original
 * Warrior returns to the field in place — at its stashed stats, keeping its
 * Weapon — instead of going to the Out Deck.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
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

/** Player 1, turn 1: a friendly Warrior is loaded into the tank. */
function tankPlay(overrides: Parameters<typeof putWarriorOnField>[2] = {}) {
  let game = newGame();
  const warrior = putWarriorOnField(game, "player1", overrides);
  const card = realCard("xl-qr517");
  game.players.player1.hand.push(card);
  game = mustApply(game, {
    kind: "playItem",
    cardId: card.id,
    targetInstanceId: warrior.instanceId,
  });
  return { game, warrior, card };
}

function p1Warrior(game: GameState, instanceId: string) {
  return game.players.player1.field.find((w) => w.instanceId === instanceId);
}

/**
 * Hands the turn to player2, drops an attacker strong enough to destroy the
 * 3100-HEALTH tank, and attacks it. Returns the post-combat game.
 */
function destroyTank(game: GameState, tankInstanceId: string): GameState {
  let g = mustApply(game, { kind: "endTurn" }); // player2 turn 2
  const attacker = putWarriorOnField(g, "player2", { currentAttack: 4000 });
  g = mustApply(g, { kind: "enterBattle" });
  g = mustApply(g, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: tankInstanceId,
  });
  return g;
}

describe("TANK_FORM (XL-QR517)", () => {
  it("resolves with no pending marker", () => {
    const { game, card } = tankPlay();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
  });

  it("overrides the Warrior's stats with the tank's and stashes the originals", () => {
    const { game, warrior } = tankPlay({
      currentAttack: 1000,
      currentHealth: 2000,
      maxHealth: 2000,
    });
    const tank = p1Warrior(game, warrior.instanceId)!;
    expect(tank.currentAttack).toBe(1500);
    expect(tank.currentHealth).toBe(3100);
    expect(tank.maxHealth).toBe(3100);
    expect(tank.tankForm).toEqual({
      originalAttack: 1000,
      originalHealth: 2000,
      originalMaxHealth: 2000,
    });
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorEnteredTank" &&
          e.instanceId === warrior.instanceId &&
          e.attack === 1500 &&
          e.health === 3100,
      ),
    ).toBe(true);
  });

  it("stashes the permanent base ATTACK, dropping temporary buffs on entry", () => {
    const { game, warrior } = tankPlay({
      currentAttack: 1700, // 1000 base + a 700 temp buff
      temporaryAttackBuffs: [{ amount: 700 }],
    });
    const tank = p1Warrior(game, warrior.instanceId)!;
    expect(tank.currentAttack).toBe(1500);
    expect(tank.temporaryAttackBuffs).toHaveLength(0);
    expect(tank.tankForm!.originalAttack).toBe(1000);
  });

  it("returns the original Warrior in place when the tank is destroyed", () => {
    let { game, warrior } = tankPlay({
      currentAttack: 1000,
      currentHealth: 2000,
      maxHealth: 2000,
    });
    game = destroyTank(game, warrior.instanceId);

    const returned = p1Warrior(game, warrior.instanceId);
    expect(returned).toBeDefined();
    expect(returned!.tankForm).toBeUndefined();
    expect(returned!.currentAttack).toBe(1000);
    expect(returned!.currentHealth).toBe(2000);
    expect(returned!.maxHealth).toBe(2000);
    // It returns to the field, never to the Out Deck, and is not "destroyed".
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(
      warrior.card.id,
    );
    expect(
      game.events.some(
        (e) => e.type === "warriorDestroyed" && e.instanceId === warrior.instanceId,
      ),
    ).toBe(false);
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorReturnedFromTank" && e.instanceId === warrior.instanceId,
      ),
    ).toBe(true);
  });

  it("keeps the attached Weapon through the tank and on return", () => {
    const weapon = makeWeaponCard();
    let { game, warrior } = tankPlay({ attachedWeapon: weapon });
    expect(p1Warrior(game, warrior.instanceId)!.attachedWeapon?.id).toBe(weapon.id);

    game = destroyTank(game, warrior.instanceId);
    expect(p1Warrior(game, warrior.instanceId)!.attachedWeapon?.id).toBe(weapon.id);
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(weapon.id);
  });

  it("refuses to put a Warrior already in the tank into another tank", () => {
    let { game, warrior } = tankPlay();
    const card = realCard("xl-qr517");
    game.players.player1.spirit += 1;
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: warrior.instanceId,
    });
    // Second Item is spent but fails; the tank stats are untouched.
    expect(p1Warrior(game, warrior.instanceId)!.currentHealth).toBe(3100);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });

  it("rejects an enemy target (friendly only)", () => {
    let game = newGame();
    const enemy = putWarriorOnField(game, "player2", {});
    const card = realCard("xl-qr517");
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: enemy.instanceId,
    });
    expect(p1Warrior(game, enemy.instanceId)).toBeUndefined();
    expect(
      game.players.player2.field.find((w) => w.instanceId === enemy.instanceId)!
        .tankForm,
    ).toBeUndefined();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });
});
