/**
 * Helpers the manual-match UI uses to surface the STEAL_ITEM_FROM_HAND choice
 * (A Thief's Pride): isStealHandItem identifies the card, getStealTargets lists
 * the Item cards in the opponent's revealed hand. The engine's actual steal
 * resolution is covered in group3-effects.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createGame, getStealTargets, isStealHandItem } from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, makeWeaponCard } from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });
const stealItem = () => makeItemCard({ effectCode: "STEAL_ITEM_FROM_HAND" });

describe("isStealHandItem", () => {
  it("is true for a STEAL_ITEM_FROM_HAND Item", () => {
    expect(isStealHandItem(stealItem())).toBe(true);
  });

  it("is false for a plain Item, a non-Item, or a different effect", () => {
    expect(isStealHandItem(makeItemCard())).toBe(false);
    expect(isStealHandItem(makeWarriorCard({ effectCode: "STEAL_ITEM_FROM_HAND" }))).toBe(false);
    expect(isStealHandItem(makeItemCard({ effectCode: "SEARCH_DECK" }))).toBe(false);
  });
});

describe("getStealTargets", () => {
  it("returns only the Item cards in the opponent's hand", () => {
    const game = newGame();
    const item = makeItemCard();
    game.players.player2.hand = [item, makeWarriorCard(), makeWeaponCard()];
    const ids = getStealTargets(game, stealItem()).map((c) => c.id);
    expect(ids).toEqual([item.id]);
  });

  it("is empty when the opponent holds no Item", () => {
    const game = newGame();
    game.players.player2.hand = [makeWarriorCard(), makeWeaponCard()];
    expect(getStealTargets(game, stealItem())).toHaveLength(0);
  });

  it("reads the opponent's hand, not the active player's own", () => {
    const game = newGame();
    game.players.player1.hand = [makeItemCard()];
    game.players.player2.hand = [];
    expect(getStealTargets(game, stealItem())).toHaveLength(0);
  });

  it("is empty for a card that does not steal", () => {
    const game = newGame();
    game.players.player2.hand = [makeItemCard()];
    expect(getStealTargets(game, makeItemCard())).toHaveLength(0);
  });
});
