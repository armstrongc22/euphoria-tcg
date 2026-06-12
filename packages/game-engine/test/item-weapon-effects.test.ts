import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeItemCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
} from "./helpers";

/** Turn 1, Player 1 active in Main Phase with 2 Spirit and an empty hand. */
function newGame(): GameState {
  const game = createGame({ decks: makeDecks(), seed: 1 });
  game.players.player1.hand = [];
  return game;
}

describe("Items resolve through the effect registry", () => {
  it("HEAL_TARGET (aliased to modifyHealth) heals the targeted Warrior", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // 2000/2000
    const item = makeItemCard({
      effectCode: "HEAL_TARGET",
      effectParams: { amount: 1500, target: "one_warrior" },
    });
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: warrior.instanceId,
    });

    expect(state.players.player1.spirit).toBe(1);
    expect(state.players.player1.field[0]?.currentHealth).toBe(3500);
    expect(state.players.player1.field[0]?.maxHealth).toBe(3500); // overheal
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === item.id),
    ).toBe(true);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(false);
  });

  it("GAIN_SPIRIT resolves via code normalization, no alias needed", () => {
    const game = newGame();
    const item = makeItemCard({
      effectCode: "GAIN_SPIRIT",
      effectParams: { amount: 2 },
    });
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });
    expect(state.players.player1.spirit).toBe(3); // 2 - 1 cost + 2 effect
  });

  it("DAMAGE_TARGET (aliased to dealDamageToWarrior) can destroy an enemy Warrior", () => {
    const game = newGame();
    const enemy = putWarriorOnField(game, "player2", { currentHealth: 800 });
    const item = makeItemCard({
      effectCode: "DAMAGE_TARGET",
      effectParams: { amount: 1000 },
    });
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: enemy.instanceId,
    });

    expect(state.players.player2.field).toHaveLength(0);
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([
      enemy.card.id,
    ]);
  });

  it("an Item with an unimplemented real-world code is spent safely", () => {
    const game = newGame();
    const item = makeItemCard({
      effectCode: "SEARCH_DECK",
      effectParams: { amount: 1, target: "dwarf_warrior" },
    });
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(state.players.player1.spirit).toBe(1); // cost stays paid
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(state.players.player1.hand).toHaveLength(0);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("a failed effect (missing target) spends the Item but changes nothing else", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const item = makeItemCard({
      effectCode: "HEAL_TARGET",
      effectParams: { amount: 1500 },
    });
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id }); // no target

    // Spent, per current behavior for unresolved effects.
    expect(state.players.player1.spirit).toBe(1);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([item.id]);
    // The failed handler's work was discarded: the Warrior is untouched.
    expect(state.players.player1.field[0]?.currentHealth).toBe(
      warrior.currentHealth,
    );
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });
});

describe("Weapons and the effect registry", () => {
  it("a Weapon with an unimplemented combat-hook passive equips normally with no invented stats", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // 1000 atk, 2000 hp
    const weapon = makeWeaponCard({
      effectCode: "WEAPON_NEGATE_ONCE_REDUCE_ATTACKER",
      timing: "while_equipped",
      effectParams: { amount: 500 },
    });
    game.players.player1.hand.push(weapon);

    const state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });

    const equipped = state.players.player1.field[0]!;
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
    expect(equipped.currentAttack).toBe(1000); // unchanged
    expect(equipped.currentHealth).toBe(2000); // unchanged
    expect(state.players.player1.spirit).toBe(0); // cost 2 paid
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(true);
  });

  it("a Weapon with an unknown on_equip code attaches without corrupting state", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard({
      effectCode: "WEAPON_GRANT_OTHER_EXTRA_ATTACK",
      timing: "on_equip",
      effectParams: { amount: 1 },
    });
    game.players.player1.hand.push(weapon);

    const state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });

    expect(state.players.player1.field[0]?.attachedWeapon?.id).toBe(weapon.id);
    expect(state.players.player1.field[0]?.currentAttack).toBe(1000);
    expect(state.players.player1.outDeck).toHaveLength(0);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(true);
  });

  it("a Weapon with a known on_equip effect resolves it against the equipped Warrior", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard({
      effectCode: "modifyAttack",
      timing: "on_equip",
      effectParams: { amount: 500 },
    });
    game.players.player1.hand.push(weapon);

    const state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });

    const equipped = state.players.player1.field[0]!;
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
    expect(equipped.currentAttack).toBe(1500);
    expect(
      state.events.some(
        (e) => e.type === "effectResolved" && e.cardId === weapon.id,
      ),
    ).toBe(true);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(false);
  });
});
