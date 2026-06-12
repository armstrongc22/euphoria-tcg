/**
 * Group 3A: SEARCH_DECK, tested with the six real search Items and real
 * search targets from cards.json.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  defaultEffectRegistry,
  type GameState,
} from "../src/index";
import { makeDecks, mustApply, realCard } from "./helpers";

/** Turn 1, Player 1 active, 2 Spirit, empty hand. */
function newGame(): GameState {
  const game = createGame({ decks: makeDecks(), seed: 1 });
  game.players.player1.hand = [];
  return game;
}

describe("SEARCH_DECK", () => {
  it("Anansi's Highway moves a Dwarf Warrior from deck to hand, updating counts", () => {
    const game = newGame();
    const dwarf = realCard("aaron-alacapati"); // Dwarf Warrior
    game.players.player1.deck.push(dwarf);
    const item = realCard("anansis-highway");
    game.players.player1.hand.push(item);
    const deckBefore = game.players.player1.deck.length;

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetDeckCardId: dwarf.id,
    });

    const p1 = state.players.player1;
    expect(p1.deck).toHaveLength(deckBefore - 1);
    expect(p1.deck.some((c) => c.id === dwarf.id)).toBe(false);
    expect(p1.hand.map((c) => c.id)).toEqual([dwarf.id]); // item left, target arrived
    expect(p1.spirit).toBe(1);
    expect(p1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      state.events.some((e) => e.type === "deckSearched" && e.cardId === dwarf.id),
    ).toBe(true);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === item.id),
    ).toBe(true);
  });

  it("Greenskin Auction House tutors a Weapon", () => {
    const game = newGame();
    const weapon = realCard("fafnir");
    game.players.player1.deck.push(weapon);
    const item = realCard("greenskin-auction-house");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetDeckCardId: weapon.id,
    });

    expect(state.players.player1.hand.map((c) => c.id)).toEqual([weapon.id]);
  });

  it("Lahkt Brand Family Products accepts either a Weapon or an Item", () => {
    const game = newGame();
    const target = realCard("gunder-love"); // Item
    game.players.player1.deck.push(target);
    const item = realCard("lahkt-brand-family-products");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetDeckCardId: target.id,
    });

    expect(state.players.player1.hand.map((c) => c.id)).toEqual([target.id]);
  });

  it("Pyro Bokor accepts a Monk Attack but rejects a non-Monk card", () => {
    const game = newGame();
    const monkAttack = realCard("7th-plague"); // Monk Attack
    const sonicWarrior = realCard("bit-schneider"); // Sonic Warrior
    game.players.player1.deck.push(monkAttack, sonicWarrior);
    const item = realCard("pyro-bokor");

    const good = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetDeckCardId: monkAttack.id,
    });
    expect(good.outcome.resolved).toBe(true);
    expect(good.state.players.player1.hand.map((c) => c.id)).toEqual([
      monkAttack.id,
    ]);

    const wrongFaction = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetDeckCardId: sonicWarrior.id,
    });
    expect(wrongFaction.outcome.resolved).toBe(false);
    if (!wrongFaction.outcome.resolved) {
      expect(wrongFaction.outcome.reason).toContain("Monk");
    }
    expect(wrongFaction.state).toBe(game);
  });

  it("rejects a selected card whose type fails the constraint", () => {
    const game = newGame();
    // The synthetic deck is all Warriors; pick one for a Weapon-only search.
    const warriorInDeck = game.players.player1.deck[0]!;
    const item = realCard("greenskin-kiln-co"); // Weapon only

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetDeckCardId: warriorInDeck.id,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("Weapon");
    }
    expect(state).toBe(game);
    expect(game.players.player1.deck.some((c) => c.id === warriorInDeck.id)).toBe(true);
  });

  it("fails safely when targetDeckCardId is missing", () => {
    const game = newGame();
    const dwarf = realCard("aaron-alacapati");
    game.players.player1.deck.push(dwarf);
    const item = realCard("reliable-henchmen");
    game.players.player1.hand.push(item);
    const deckBefore = game.players.player1.deck.length;

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    // Item spent per current behavior; deck and hand otherwise unchanged.
    expect(state.players.player1.deck).toHaveLength(deckBefore);
    expect(state.players.player1.hand).toHaveLength(0);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("fails safely for a card id that is not in the deck", () => {
    const game = newGame();
    const item = realCard("anansis-highway");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetDeckCardId: "ghost",
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
      expect(outcome.reason).toContain("deck");
    }
    expect(state).toBe(game);
  });

  it("cannot search a card sitting in hand or the Out Deck instead of the deck", () => {
    const game = newGame();
    const dwarf = realCard("aaron-alacapati");
    game.players.player1.hand.push(dwarf); // in hand, not in deck
    const item = realCard("anansis-highway");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetDeckCardId: dwarf.id,
    });

    expect(outcome.resolved).toBe(false);
    expect(state).toBe(game);
  });
});

describe("STEAL_ITEM_FROM_HAND via A Thief's Pride", () => {
  it("moves the chosen Item from the opponent's hand to the controller's hand", () => {
    const game = newGame();
    const loot = realCard("gunder-love"); // Item in opponent's hand
    const keeper = realCard("bit-schneider"); // Warrior stays behind
    game.players.player2.hand = [loot, keeper];
    const thief = realCard("a-thiefs-pride");
    game.players.player1.hand.push(thief);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: thief.id,
      targetOpponentHandCardId: loot.id,
    });

    expect(state.players.player1.hand.map((c) => c.id)).toEqual([loot.id]);
    expect(state.players.player2.hand.map((c) => c.id)).toEqual([keeper.id]);
    expect(state.players.player1.spirit).toBe(1);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([thief.id]);
    expect(
      state.events.some(
        (e) =>
          e.type === "cardStolenFromHand" &&
          e.cardId === loot.id &&
          e.fromPlayer === "player2",
      ),
    ).toBe(true);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === thief.id),
    ).toBe(true);
  });

  it("fails safely when targetOpponentHandCardId is missing", () => {
    const game = newGame();
    game.players.player2.hand = [realCard("gunder-love")];
    const thief = realCard("a-thiefs-pride");
    game.players.player1.hand.push(thief);

    const state = mustApply(game, { kind: "playItem", cardId: thief.id });

    expect(state.players.player1.hand).toHaveLength(0);
    expect(state.players.player2.hand).toHaveLength(1);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([thief.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === thief.id,
      ),
    ).toBe(true);
  });

  it("fails safely for a card id that is not in the opponent's hand", () => {
    const game = newGame();
    const thief = realCard("a-thiefs-pride");

    const { outcome, state } = defaultEffectRegistry.resolve(game, thief, {
      player: "player1",
      targetOpponentHandCardId: "ghost",
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
      expect(outcome.reason).toContain("opponent's hand");
    }
    expect(state).toBe(game);
  });

  it("rejects stealing a non-Item from the opponent's hand", () => {
    const game = newGame();
    const warrior = realCard("bit-schneider");
    game.players.player2.hand = [warrior];
    const thief = realCard("a-thiefs-pride");

    const { outcome, state } = defaultEffectRegistry.resolve(game, thief, {
      player: "player1",
      targetOpponentHandCardId: warrior.id,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("not an Item");
    }
    expect(state).toBe(game);
    expect(game.players.player2.hand.map((c) => c.id)).toEqual([warrior.id]);
  });

  it("cannot select a card that is only in the controller's own hand", () => {
    const game = newGame();
    const ownItem = realCard("gunder-love");
    game.players.player1.hand.push(ownItem); // own hand, not opponent's
    game.players.player2.hand = [];
    const thief = realCard("a-thiefs-pride");

    const { outcome, state } = defaultEffectRegistry.resolve(game, thief, {
      player: "player1",
      targetOpponentHandCardId: ownItem.id,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("opponent's hand");
    }
    expect(state).toBe(game);
    expect(game.players.player1.hand.map((c) => c.id)).toEqual([ownItem.id]);
  });
});
