import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getCompatibleAttackCards,
  getLegalActions,
  type GameAction,
  type GameState,
  type WarriorInPlay,
} from "../src/index";
import {
  makeAttackCard,
  makeDecks,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
} from "./helpers";

function expectError(state: GameState, action: GameAction, code: string): void {
  const result = applyAction(state, action);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

/**
 * Turn 2, Player 2 active, in Main Phase: a Dwarf attacker on P2's field and
 * a tough defender on P1's. P2 has 2 Spirit. Hands are emptied so each test
 * controls exactly which Attack cards are available.
 */
function dwarfBattle(): {
  game: GameState;
  attacker: WarriorInPlay;
  defender: WarriorInPlay;
} {
  const game = createGame({ decks: makeDecks(), seed: 1 });
  const turn2 = mustApply(game, { kind: "endTurn" });
  turn2.players.player2.hand = [];
  const attacker = putWarriorOnField(turn2, "player2", {
    card: makeWarriorCard({ faction: "Dwarf" }),
    currentAttack: 500,
  });
  const defender = putWarriorOnField(turn2, "player1", { currentHealth: 9000 });
  return { game: turn2, attacker, defender };
}

function attack(
  attacker: WarriorInPlay,
  defender: WarriorInPlay,
  extra: Partial<Extract<GameAction, { kind: "attack" }>> = {},
): GameAction {
  return {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
    ...extra,
  };
}

describe("attack-card window", () => {
  it("requires a choice when a compatible Attack card is in hand", () => {
    const { game, attacker, defender } = dwarfBattle();
    game.players.player2.hand.push(makeAttackCard("Dwarf"));
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(state, attack(attacker, defender), "ATTACK_CARD_CHOICE_REQUIRED");
  });

  it("skipAttackCard resolves the attack without using the card", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf");
    game.players.player2.hand.push(card);
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender, { skipAttackCard: true }));

    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
    expect(state.players.player2.hand.map((c) => c.id)).toEqual([card.id]);
    expect(state.players.player2.spirit).toBe(2);
  });

  it("a Dwarf Warrior can use a Dwarf Attack card: Spirit paid, card to Out Deck, damage unmodified", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf");
    game.players.player2.hand.push(card);
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(
      state,
      attack(attacker, defender, { selectedAttackCardId: card.id }),
    );

    expect(state.players.player2.spirit).toBe(1); // 2 - cost 1
    expect(state.players.player2.hand).toHaveLength(0);
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
    // Effect is pending a handler: damage stays the attacker's base 500.
    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
    expect(
      state.events.some(
        (e) => e.type === "attackCardUsed" && e.cardId === card.id,
      ),
    ).toBe(true);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });

  it.each(["Monk", "Sonic", "Surfer", "Shaman"] as const)(
    "a Dwarf Warrior cannot use a %s Attack card",
    (faction) => {
      const { game, attacker, defender } = dwarfBattle();
      const card = makeAttackCard(faction);
      game.players.player2.hand.push(card);
      const state = mustApply(game, { kind: "enterBattle" });

      expectError(
        state,
        attack(attacker, defender, { selectedAttackCardId: card.id }),
        "ATTACK_CARD_INCOMPATIBLE",
      );
    },
  );

  it("does not require a choice when only off-faction Attack cards are in hand", () => {
    const { game, attacker, defender } = dwarfBattle();
    game.players.player2.hand.push(makeAttackCard("Monk"));
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender)); // no choice needed

    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
  });

  it("a Shaman Warrior can use a Shaman Attack card", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const turn2 = mustApply(game, { kind: "endTurn" });
    turn2.players.player2.hand = [];
    const attacker = putWarriorOnField(turn2, "player2", {
      card: makeWarriorCard({ faction: "Shaman" }),
    });
    const defender = putWarriorOnField(turn2, "player1", { currentHealth: 9000 });
    const card = makeAttackCard("Shaman");
    turn2.players.player2.hand.push(card);

    let state = mustApply(turn2, { kind: "enterBattle" });
    state = mustApply(
      state,
      attack(attacker, defender, { selectedAttackCardId: card.id }),
    );
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
  });

  it("Neutral Attack cards are not compatible with any Warrior", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Neutral");
    game.players.player2.hand.push(card);
    const state = mustApply(game, { kind: "enterBattle" });

    // No prompt is triggered by it...
    const skipless = applyAction(state, attack(attacker, defender));
    expect(skipless.ok).toBe(true);
    // ...and selecting it is rejected.
    expectError(
      state,
      attack(attacker, defender, { selectedAttackCardId: card.id }),
      "ATTACK_CARD_INCOMPATIBLE",
    );
  });

  it("rejects an Attack card the player cannot afford, and it triggers no prompt", () => {
    const { game, attacker, defender } = dwarfBattle();
    const pricey = makeAttackCard("Dwarf", { spiritCost: 3, cost: 3 }); // spirit is 2
    game.players.player2.hand.push(pricey);
    const state = mustApply(game, { kind: "enterBattle" });

    const skipless = applyAction(state, attack(attacker, defender));
    expect(skipless.ok).toBe(true); // unaffordable card does not force a choice

    expectError(
      state,
      attack(attacker, defender, { selectedAttackCardId: pricey.id }),
      "INSUFFICIENT_SPIRIT",
    );
  });

  it("rejects an Attack card that is not in hand", () => {
    const { game, attacker, defender } = dwarfBattle();
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      attack(attacker, defender, { selectedAttackCardId: "ghost" }),
      "CARD_NOT_IN_HAND",
    );
  });

  it("rejects selecting a non-Attack card", () => {
    const { game, attacker, defender } = dwarfBattle();
    const warriorCard = makeWarriorCard();
    game.players.player2.hand.push(warriorCard);
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      attack(attacker, defender, { selectedAttackCardId: warriorCard.id }),
      "WRONG_CARD_TYPE",
    );
  });

  it("rejects providing both a selection and a skip", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf");
    game.players.player2.hand.push(card);
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      attack(attacker, defender, {
        selectedAttackCardId: card.id,
        skipAttackCard: true,
      }),
      "ATTACK_CARD_CHOICE_REQUIRED",
    );
  });

  it("consumes one copy when the hand holds duplicates", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf");
    game.players.player2.hand.push(card, card);
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(
      state,
      attack(attacker, defender, { selectedAttackCardId: card.id }),
    );

    expect(state.players.player2.hand.map((c) => c.id)).toEqual([card.id]);
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
  });

  it("never prompts on direct attacks", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const turn2 = mustApply(game, { kind: "endTurn" });
    turn2.players.player2.hand = [];
    const attacker = putWarriorOnField(turn2, "player2", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const card = makeAttackCard("Dwarf");
    turn2.players.player2.hand.push(card);

    let state = mustApply(turn2, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(state.players.player1.lives).toBe(2);
    expect(state.players.player2.hand.map((c) => c.id)).toEqual([card.id]);
    expect(state.players.player2.spirit).toBe(2);
  });
});

describe("getCompatibleAttackCards", () => {
  it("returns only same-faction, affordable Attack cards, deduped", () => {
    const { game, attacker } = dwarfBattle();
    const usable = makeAttackCard("Dwarf");
    const offFaction = makeAttackCard("Sonic");
    const pricey = makeAttackCard("Dwarf", { spiritCost: 3, cost: 3 });
    game.players.player2.hand.push(usable, usable, offFaction, pricey);
    const state = mustApply(game, { kind: "enterBattle" });

    expect(
      getCompatibleAttackCards(state, attacker.instanceId).map((c) => c.id),
    ).toEqual([usable.id]);
  });
});

describe("getLegalActions with attack cards", () => {
  it("offers each compatible Attack card plus the skip option", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf");
    game.players.player2.hand.push(card);
    const state = mustApply(game, { kind: "enterBattle" });

    const actions = getLegalActions(state);
    expect(actions).toContainEqual(
      attack(attacker, defender, { selectedAttackCardId: card.id }),
    );
    expect(actions).toContainEqual(
      attack(attacker, defender, { skipAttackCard: true }),
    );
    // The bare action would be rejected, so it is not offered.
    expect(actions).not.toContainEqual(attack(attacker, defender));
  });

  it("offers the bare attack when no compatible Attack card is usable", () => {
    const { game, attacker, defender } = dwarfBattle();
    game.players.player2.hand.push(makeAttackCard("Monk"));
    const state = mustApply(game, { kind: "enterBattle" });

    const actions = getLegalActions(state);
    expect(actions).toContainEqual(attack(attacker, defender));
    expect(
      actions.some((a) => a.kind === "attack" && a.skipAttackCard === true),
    ).toBe(false);
  });
});
