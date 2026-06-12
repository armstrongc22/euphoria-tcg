/**
 * Group 1 custom effects: no-choice handlers tested with the real cards
 * from data/cards/cards.json that carry each effectCode.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

/** Turn 1, Player 1 active, 2 Spirit, empty hand. */
function newGame(): GameState {
  const game = createGame({ decks: makeDecks(), seed: 1 });
  game.players.player1.hand = [];
  return game;
}

/** Turn 2, Player 2 active (attacks legal), 2 Spirit, empty hand. */
function turnTwo(): GameState {
  const state = mustApply(createGame({ decks: makeDecks(), seed: 1 }), {
    kind: "endTurn",
  });
  state.players.player2.hand = [];
  return state;
}

function expectResolved(state: GameState, cardId: string): void {
  expect(
    state.events.some((e) => e.type === "effectResolved" && e.cardId === cardId),
  ).toBe(true);
  expect(
    state.events.some(
      (e) => e.type === "effectNotImplemented" && e.cardId === cardId,
    ),
  ).toBe(false);
}

describe("DAMAGE_ALL_OPPONENT_WARRIORS", () => {
  it("XL-C2K TYPE R (Item) deals 500 to every opponent Warrior, destroying lethally", () => {
    const game = newGame();
    const dying = putWarriorOnField(game, "player2", { currentHealth: 400 });
    putWarriorOnField(game, "player2", { currentHealth: 2000 });
    const item = realCard("xl-c2k-type-r");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(state.players.player1.spirit).toBe(1);
    expect(state.players.player2.field).toHaveLength(1);
    expect(state.players.player2.field[0]?.currentHealth).toBe(1500);
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([
      dying.card.id,
    ]);
    expectResolved(state, item.id);
  });

  it("7th Plague (Monk Attack) deals 1000 to all opponent Warriors before combat", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const bystander = putWarriorOnField(game, "player1", { currentHealth: 2000 });
    const card = realCard("7th-plague");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    // Defender: 9000 - 1000 (AoE) - 500 (combat); bystander: 2000 - 1000.
    expect(state.players.player1.field[0]?.currentHealth).toBe(7500);
    expect(state.players.player1.field[1]?.currentHealth).toBe(1000);
    expect(bystander.instanceId).toBe(state.players.player1.field[1]?.instanceId);
    expectResolved(state, card.id);
  });
});

describe("HEAL_ALL_YOUR_WARRIORS", () => {
  it("Cryraven Circus heals every friendly Warrior by 750, with overheal", () => {
    const game = newGame();
    putWarriorOnField(game, "player1", { currentHealth: 1000 }); // hurt
    putWarriorOnField(game, "player1"); // full 2000/2000
    const enemy = putWarriorOnField(game, "player2");
    const item = realCard("cryraven-circus");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(state.players.player1.field[0]?.currentHealth).toBe(1750);
    expect(state.players.player1.field[1]?.currentHealth).toBe(2750);
    expect(state.players.player1.field[1]?.maxHealth).toBe(2750);
    // Opponent untouched.
    expect(state.players.player2.field[0]?.currentHealth).toBe(
      enemy.currentHealth,
    );
    expectResolved(state, item.id);
  });
});

describe("GAIN_SPIRIT_IF_TWO_SAME_FACTION_WARRIORS", () => {
  it("Best Friend's Bond gains 2 Spirit with two same-faction Warriors", () => {
    const game = newGame();
    putWarriorOnField(game, "player1"); // Monk
    putWarriorOnField(game, "player1"); // Monk
    const item = realCard("best-friends-bond");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });
    expect(state.players.player1.spirit).toBe(3); // 2 - 1 cost + 2
    expectResolved(state, item.id);
  });

  it("resolves with no gain when the condition is not met", () => {
    const game = newGame();
    putWarriorOnField(game, "player1", { card: makeWarriorCard({ faction: "Monk" }) });
    putWarriorOnField(game, "player1", { card: makeWarriorCard({ faction: "Dwarf" }) });
    const item = realCard("best-friends-bond");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });
    expect(state.players.player1.spirit).toBe(1); // cost only, no gain
    expectResolved(state, item.id); // the condition evaluating false still resolves
  });
});

describe("ATTACK_DAMAGE_BONUS", () => {
  it("Oak Splitter 5x (Dwarf) adds 2000 damage to the attack as a temporary buff", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Dwarf" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const card = realCard("oak-splitter-5x");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player1.field[0]?.currentHealth).toBe(6500); // 500 + 2000
    expect(state.players.player2.field[0]?.temporaryAttackBuffs).toEqual([
      { amount: 2000 },
    ]);
    expectResolved(state, card.id);
  });

  it("Floe Breaker (Surfer, duration next_attack) is also a temporary buff", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Surfer" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const card = realCard("floe-breaker");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player1.field[0]?.currentHealth).toBe(6500);
    expect(state.players.player2.field[0]?.temporaryAttackBuffs).toEqual([
      { amount: 2000 },
    ]);
  });
});

describe("BUFF_FRIENDLY_FACTION_THIS_TURN", () => {
  it("Flame Training buffs only friendly Monk Warriors, temporarily", () => {
    const game = newGame();
    const monk = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const dwarf = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const enemyMonk = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("flame-training");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    const fields = state.players.player1.field;
    expect(fields.find((w) => w.instanceId === monk.instanceId)?.currentAttack).toBe(1500);
    expect(fields.find((w) => w.instanceId === monk.instanceId)?.temporaryAttackBuffs).toEqual([{ amount: 500 }]);
    expect(fields.find((w) => w.instanceId === dwarf.instanceId)?.currentAttack).toBe(1000);
    expect(state.players.player2.field[0]?.currentAttack).toBe(enemyMonk.currentAttack);
    expectResolved(state, item.id);
  });
});

describe("WEAPON_ATTACK_HEALTH_BONUS", () => {
  it("Fairy's Treasure Chest grants +1000 ATTACK and +1000 HEALTH on equip", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // 1000/2000
    const weapon = realCard("fairys-treasure-chest");
    game.players.player1.hand.push(weapon);

    const state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });

    const equipped = state.players.player1.field[0]!;
    expect(equipped.attachedWeapon?.id).toBe(weapon.id);
    expect(equipped.currentAttack).toBe(2000);
    expect(equipped.currentHealth).toBe(3000);
    expect(equipped.maxHealth).toBe(3000);
    expectResolved(state, weapon.id);
  });
});

describe("WEAPON_ATTACK_BONUS_FACTION_BONUS", () => {
  it("real Fafnir stays safely pending: its data lacks the targetFaction param", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const weapon = realCard("fafnir");
    game.players.player1.hand.push(weapon);

    const state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });

    // Attached, but no stat change and the pending marker is emitted.
    expect(state.players.player1.field[0]?.attachedWeapon?.id).toBe(weapon.id);
    expect(state.players.player1.field[0]?.currentAttack).toBe(1000);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === weapon.id,
      ),
    ).toBe(true);
  });

  it("with a targetFaction param, matching factions get the larger bonus", () => {
    const game = newGame();
    game.players.player1.spirit = 4;
    const monk = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const dwarf = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const params = { amount: 500, secondaryAmount: 1000, targetFaction: "Monk" };
    const forMonk = {
      ...realCard("fafnir"),
      id: "fafnir_fixed_a",
      effectParams: params,
    };
    const forDwarf = {
      ...realCard("fafnir"),
      id: "fafnir_fixed_b",
      effectParams: params,
    };
    game.players.player1.hand.push(forMonk, forDwarf);

    let state = mustApply(game, {
      kind: "equipWeapon",
      cardId: forMonk.id,
      warriorInstanceId: monk.instanceId,
    });
    state = mustApply(state, {
      kind: "equipWeapon",
      cardId: forDwarf.id,
      warriorInstanceId: dwarf.instanceId,
    });

    const fields = state.players.player1.field;
    expect(fields.find((w) => w.instanceId === monk.instanceId)?.currentAttack).toBe(2000); // +1000
    expect(fields.find((w) => w.instanceId === dwarf.instanceId)?.currentAttack).toBe(1500); // +500
  });
});

describe("SLUSH_FUND", () => {
  it("pools both players' Spirit and gives the activator the rounded-up half", () => {
    const game = newGame();
    game.players.player2.spirit = 4;
    const item = realCard("slush-fund");
    game.players.player1.hand.push(item);

    // P1 pays 1 (2 -> 1), then pot = 1 + 4 = 5: P1 gets 3, P2 gets 2.
    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(state.players.player1.spirit).toBe(3);
    expect(state.players.player2.spirit).toBe(2);
    expect(
      state.events.filter((e) => e.type === "spiritChanged"),
    ).toHaveLength(2);
    expectResolved(state, item.id);
  });
});
