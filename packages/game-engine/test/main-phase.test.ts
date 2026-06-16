import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalActions, type GameState } from "../src/index";
import {
  makeDecks,
  makeItemCard,
  makeWarriorCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
} from "./helpers";

/** Fresh game in P1's turn-1 Main Phase (P1 has 2 Spirit). */
function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function expectError(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
  code: string,
): void {
  const result = applyAction(state, action);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe("summon Warrior", () => {
  it("summons a Warrior: pays Spirit, leaves hand, enters the field", () => {
    const game = newGame();
    const card = makeWarriorCard({ attack: 1200, health: 3000 });
    game.players.player1.hand.push(card);

    const next = mustApply(game, { kind: "playWarrior", cardId: card.id });
    const p1 = next.players.player1;

    expect(p1.spirit).toBe(1); // 2 - cost 1
    expect(p1.hand.some((c) => c.id === card.id)).toBe(false);
    expect(p1.field).toHaveLength(1);
    const warrior = p1.field[0]!;
    expect(warrior.card.id).toBe(card.id);
    expect(warrior.currentAttack).toBe(1200);
    expect(warrior.currentHealth).toBe(3000);
    expect(warrior.maxHealth).toBe(3000);
    expect(warrior.attacksRemaining).toBe(1);
    expect(
      next.events.some(
        (e) => e.type === "warriorSummoned" && e.cardId === card.id,
      ),
    ).toBe(true);
  });

  it("assigns unique instance ids across summons", () => {
    // Verifies instance-id uniqueness, not the per-turn summon cap, so raise the
    // cap (default 1) to allow two summons in the same turn.
    const game = createGame({
      decks: makeDecks(),
      seed: 1,
      config: { warriorSummonsPerTurn: 2 },
    });
    game.players.player1.spirit = 5;
    const a = makeWarriorCard();
    const b = makeWarriorCard();
    game.players.player1.hand.push(a, b);

    let state = mustApply(game, { kind: "playWarrior", cardId: a.id });
    state = mustApply(state, { kind: "playWarrior", cardId: b.id });

    const ids = state.players.player1.field.map((w) => w.instanceId);
    expect(new Set(ids).size).toBe(2);
  });

  it("consumes only one copy when the hand holds duplicates", () => {
    const game = newGame();
    game.players.player1.spirit = 5;
    const card = makeWarriorCard();
    game.players.player1.hand.push(card, card);

    const next = mustApply(game, { kind: "playWarrior", cardId: card.id });
    expect(
      next.players.player1.hand.filter((c) => c.id === card.id),
    ).toHaveLength(1);
    expect(next.players.player1.field).toHaveLength(1);
  });

  it("rejects a summon the player cannot afford", () => {
    const game = newGame();
    const card = makeWarriorCard({ spiritCost: 3, cost: 3 }); // Shaman-priced
    game.players.player1.hand.push(card);

    expectError(game, { kind: "playWarrior", cardId: card.id }, "INSUFFICIENT_SPIRIT");
  });

  it("rejects a summon when all 5 Warrior slots are filled", () => {
    const game = newGame();
    for (let i = 0; i < 5; i++) putWarriorOnField(game, "player1");
    const card = makeWarriorCard();
    game.players.player1.hand.push(card);

    expectError(game, { kind: "playWarrior", cardId: card.id }, "FIELD_FULL");
  });

  it("rejects summoning outside Main Phase", () => {
    const game = newGame();
    const card = makeWarriorCard();
    game.players.player1.hand.push(card);
    const inBattle = mustApply(game, { kind: "enterBattle" });

    expectError(inBattle, { kind: "playWarrior", cardId: card.id }, "WRONG_PHASE");
  });

  it("rejects summoning a non-Warrior card", () => {
    const game = newGame();
    const item = makeItemCard();
    game.players.player1.hand.push(item);

    expectError(game, { kind: "playWarrior", cardId: item.id }, "WRONG_CARD_TYPE");
  });

  it("rejects a card that is not in hand", () => {
    const game = newGame();
    expectError(game, { kind: "playWarrior", cardId: "nope" }, "CARD_NOT_IN_HAND");
  });
});

describe("play Item", () => {
  it("plays an Item: pays Spirit, moves it to the Out Deck, marks the effect", () => {
    const game = newGame();
    const item = makeItemCard();
    game.players.player1.hand.push(item);

    const next = mustApply(game, { kind: "playItem", cardId: item.id });
    const p1 = next.players.player1;

    expect(p1.spirit).toBe(1); // 2 - cost 1
    expect(p1.hand.some((c) => c.id === item.id)).toBe(false);
    expect(p1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      next.events.some((e) => e.type === "itemPlayed" && e.cardId === item.id),
    ).toBe(true);
    // Uncoded effects still resolve but are marked as needing handlers.
    expect(
      next.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("rejects Items once Battle Phase has begun", () => {
    const game = newGame();
    const item = makeItemCard();
    game.players.player1.hand.push(item);
    const inBattle = mustApply(game, { kind: "enterBattle" });

    expectError(inBattle, { kind: "playItem", cardId: item.id }, "WRONG_PHASE");
  });

  it("rejects playing a non-Item as an Item", () => {
    const game = newGame();
    const warriorId = game.players.player1.hand[0]!.id;

    expectError(game, { kind: "playItem", cardId: warriorId }, "WRONG_CARD_TYPE");
  });

  it("rejects an Item the player cannot afford", () => {
    const game = newGame();
    const item = makeItemCard();
    game.players.player1.hand.push(item);
    game.players.player1.spirit = 0;

    expectError(game, { kind: "playItem", cardId: item.id }, "INSUFFICIENT_SPIRIT");
  });
});

describe("equip Weapon", () => {
  it("equips a Weapon: pays 2 Spirit, attaches it, does not go to the Out Deck", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);

    const next = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });
    const p1 = next.players.player1;

    expect(p1.spirit).toBe(0); // 2 - cost 2
    expect(p1.hand.some((c) => c.id === weapon.id)).toBe(false);
    expect(p1.field[0]?.attachedWeapon?.id).toBe(weapon.id);
    expect(p1.outDeck).toHaveLength(0);
    expect(
      next.events.some(
        (e) => e.type === "weaponEquipped" && e.cardId === weapon.id,
      ),
    ).toBe(true);
  });

  it("keeps the Weapon attached across turn cycles", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);

    let state = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: warrior.instanceId,
    });
    state = mustApply(state, { kind: "endTurn" }); // P2's turn
    state = mustApply(state, { kind: "endTurn" }); // back to P1

    expect(state.players.player1.field[0]?.attachedWeapon?.id).toBe(weapon.id);
  });

  it("rejects a second Weapon on the same Warrior", () => {
    const game = newGame();
    game.players.player1.spirit = 4;
    const warrior = putWarriorOnField(game, "player1");
    const first = makeWeaponCard();
    const second = makeWeaponCard();
    game.players.player1.hand.push(first, second);

    const next = mustApply(game, {
      kind: "equipWeapon",
      cardId: first.id,
      warriorInstanceId: warrior.instanceId,
    });
    expectError(
      next,
      { kind: "equipWeapon", cardId: second.id, warriorInstanceId: warrior.instanceId },
      "WEAPON_ALREADY_EQUIPPED",
    );
  });

  it("rejects Weapons once Battle Phase has begun", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);
    const inBattle = mustApply(game, { kind: "enterBattle" });

    expectError(
      inBattle,
      { kind: "equipWeapon", cardId: weapon.id, warriorInstanceId: warrior.instanceId },
      "WRONG_PHASE",
    );
  });

  it("rejects equipping to a Warrior that does not exist", () => {
    const game = newGame();
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);

    expectError(
      game,
      { kind: "equipWeapon", cardId: weapon.id, warriorInstanceId: "ghost" },
      "WARRIOR_NOT_FOUND",
    );
  });

  it("rejects equipping to an opponent's Warrior", () => {
    const game = newGame();
    const enemy = putWarriorOnField(game, "player2");
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);

    expectError(
      game,
      { kind: "equipWeapon", cardId: weapon.id, warriorInstanceId: enemy.instanceId },
      "WARRIOR_NOT_FOUND",
    );
  });
});

describe("getLegalActions in Main Phase", () => {
  it("offers affordable plays and skips unaffordable ones", () => {
    const game = newGame();
    game.players.player1.hand = [];
    const cheap = makeWarriorCard(); // cost 1, spirit is 2
    const pricey = makeWarriorCard({ spiritCost: 3, cost: 3 });
    const item = makeItemCard(); // cost 1
    game.players.player1.hand.push(cheap, pricey, item);

    const actions = getLegalActions(game);
    expect(actions).toContainEqual({ kind: "playWarrior", cardId: cheap.id });
    expect(actions).toContainEqual({ kind: "playItem", cardId: item.id });
    expect(actions.some((a) => "cardId" in a && a.cardId === pricey.id)).toBe(false);
  });

  it("stops offering summons when the field is full", () => {
    const game = newGame();
    for (let i = 0; i < 5; i++) putWarriorOnField(game, "player1");

    const actions = getLegalActions(game);
    expect(actions.some((a) => a.kind === "playWarrior")).toBe(false);
  });

  it("offers Weapon equips only for weaponless Warriors", () => {
    const game = newGame();
    game.players.player1.hand = [];
    const armed = putWarriorOnField(game, "player1", {
      attachedWeapon: makeWeaponCard(),
    });
    const unarmed = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard();
    game.players.player1.hand.push(weapon);

    const actions = getLegalActions(game);
    expect(actions).toContainEqual({
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: unarmed.instanceId,
    });
    expect(
      actions.some(
        (a) =>
          a.kind === "equipWeapon" && a.warriorInstanceId === armed.instanceId,
      ),
    ).toBe(false);
  });
});
