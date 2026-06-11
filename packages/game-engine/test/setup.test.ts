import { describe, expect, it } from "vitest";
import { createGame } from "../src/index";
import { makeDeck, makeDecks } from "./helpers";

describe("game setup", () => {
  it("deals opening hands and resolves Player 1's first Start Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 42 });
    const p1 = game.players.player1;
    const p2 = game.players.player2;

    // P1's turn 1 already ran: +1 Spirit (1 -> 2) and the turn draw (5 -> 6).
    expect(p1.hand).toHaveLength(6);
    expect(p1.deck).toHaveLength(24);
    expect(p1.spirit).toBe(2);

    expect(p2.hand).toHaveLength(5);
    expect(p2.deck).toHaveLength(25);
    expect(p2.spirit).toBe(1);

    expect(p1.lives).toBe(3);
    expect(p2.lives).toBe(3);
    expect(game.turn).toBe(1);
    expect(game.activePlayer).toBe("player1");
    expect(game.phase).toBe("main");
    expect(game.winner).toBeNull();
  });

  it("shuffles identically for the same seed", () => {
    const decks = makeDecks();
    const a = createGame({ decks, seed: 7 });
    const b = createGame({ decks, seed: 7 });

    expect(a.players.player1.hand.map((c) => c.id)).toEqual(
      b.players.player1.hand.map((c) => c.id),
    );
    expect(a.players.player2.deck.map((c) => c.id)).toEqual(
      b.players.player2.deck.map((c) => c.id),
    );
  });

  it("shuffles differently for different seeds", () => {
    const decks = makeDecks();
    const a = createGame({ decks, seed: 1 });
    const b = createGame({ decks, seed: 2 });

    const order = (g: typeof a) => [
      ...g.players.player1.hand.map((c) => c.id),
      ...g.players.player1.deck.map((c) => c.id),
    ];
    expect(order(a)).not.toEqual(order(b));
  });

  it("never mutates the deck arrays passed in", () => {
    const deck1 = makeDeck();
    const deck2 = makeDeck();
    const before1 = deck1.map((c) => c.id);
    const before2 = deck2.map((c) => c.id);

    createGame({ decks: { player1: deck1, player2: deck2 }, seed: 3 });

    expect(deck1.map((c) => c.id)).toEqual(before1);
    expect(deck2.map((c) => c.id)).toEqual(before2);
  });

  it("rejects decks that are not exactly deckSize", () => {
    expect(() =>
      createGame({
        decks: { player1: makeDeck(29), player2: makeDeck() },
        seed: 1,
      }),
    ).toThrow(/exactly 30 cards/);
  });

  it("supports unshuffled decks for scripted scenarios", () => {
    const deck1 = makeDeck();
    const game = createGame({
      decks: { player1: deck1, player2: makeDeck() },
      shuffleDecks: false,
    });
    // Opening hand 0-4 plus the turn-1 draw of card 5, in deck order.
    expect(game.players.player1.hand.map((c) => c.id)).toEqual(
      deck1.slice(0, 6).map((c) => c.id),
    );
  });
});
