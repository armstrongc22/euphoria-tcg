/**
 * Helpers the manual-match UI uses to surface the REVIVE_WARRIOR choice
 * (Totem's Creation): isOutDeckReviveItem identifies the card, getReviveTargets
 * lists the valid Out-Deck Warriors. The engine's actual revive resolution is
 * covered in group2b-effects.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createGame, getReviveTargets, isOutDeckReviveItem } from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, makeWeaponCard } from "./helpers";

const reviveItem = () => makeItemCard({ effectCode: "REVIVE_WARRIOR" });
const newGame = () => createGame({ decks: makeDecks(), seed: 1 });

describe("isOutDeckReviveItem", () => {
  it("is true for a REVIVE_WARRIOR Item", () => {
    expect(isOutDeckReviveItem(reviveItem())).toBe(true);
  });

  it("is false for a plain Item or a non-Item", () => {
    expect(isOutDeckReviveItem(makeItemCard())).toBe(false);
    expect(
      isOutDeckReviveItem(makeWarriorCard({ effectCode: "REVIVE_WARRIOR" })),
    ).toBe(false);
  });
});

describe("getReviveTargets", () => {
  it("returns the Warriors in the active player's Out Deck", () => {
    const game = newGame();
    const w1 = makeWarriorCard();
    const w2 = makeWarriorCard();
    game.players.player1.outDeck.push(w1, w2);
    const ids = getReviveTargets(game, reviveItem()).map((c) => c.id);
    expect(ids.sort()).toEqual([w1.id, w2.id].sort());
  });

  it("excludes non-Warrior Out Deck cards", () => {
    const game = newGame();
    game.players.player1.outDeck.push(makeItemCard(), makeWeaponCard());
    expect(getReviveTargets(game, reviveItem())).toHaveLength(0);
  });

  it("is empty when the Out Deck has no Warrior", () => {
    const game = newGame();
    expect(getReviveTargets(game, reviveItem())).toHaveLength(0);
  });

  it("is empty for a card that does not revive", () => {
    const game = newGame();
    game.players.player1.outDeck.push(makeWarriorCard());
    expect(getReviveTargets(game, makeItemCard())).toHaveLength(0);
  });

  it("reads the active player's Out Deck, not the opponent's", () => {
    const game = newGame();
    game.players.player2.outDeck.push(makeWarriorCard());
    expect(getReviveTargets(game, reviveItem())).toHaveLength(0);
  });
});
