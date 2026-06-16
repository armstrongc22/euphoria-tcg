/**
 * Helpers the manual-match UI uses to surface the SEARCH_DECK choice (Lahkt
 * Brand Family Products): isDeckSearchItem identifies the card,
 * getDeckSearchTargets lists the eligible deck cards (by effectParams.targetTypes
 * and optional targetFaction). The engine's actual search resolution is covered
 * in group3-effects.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createGame, getDeckSearchTargets, isDeckSearchItem } from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, makeWeaponCard } from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });

/** A Lahkt-like deck-search Item: adds a Weapon or Item from deck to hand. */
const searchItem = (overrides = {}) =>
  makeItemCard({
    effectCode: "SEARCH_DECK",
    effectParams: { targetTypes: ["Weapon", "Item"] },
    ...overrides,
  });

describe("isDeckSearchItem", () => {
  it("is true for a SEARCH_DECK Item", () => {
    expect(isDeckSearchItem(searchItem())).toBe(true);
  });

  it("is false for a plain Item, a non-Item, or a revive Item", () => {
    expect(isDeckSearchItem(makeItemCard())).toBe(false);
    expect(isDeckSearchItem(makeWarriorCard({ effectCode: "SEARCH_DECK" }))).toBe(false);
    expect(isDeckSearchItem(makeItemCard({ effectCode: "REVIVE_WARRIOR" }))).toBe(false);
  });
});

describe("getDeckSearchTargets", () => {
  it("returns the Items and Weapons in the active player's deck", () => {
    const game = newGame();
    const item = makeItemCard();
    const weapon = makeWeaponCard();
    game.players.player1.deck = [item, weapon, makeWarriorCard()];
    const ids = getDeckSearchTargets(game, searchItem()).map((c) => c.id);
    expect(ids.sort()).toEqual([item.id, weapon.id].sort());
  });

  it("excludes cards whose type is not in targetTypes (e.g. Warriors)", () => {
    const game = newGame();
    game.players.player1.deck = [makeWarriorCard(), makeWarriorCard()];
    expect(getDeckSearchTargets(game, searchItem())).toHaveLength(0);
  });

  it("respects targetFaction when present", () => {
    const game = newGame();
    const dwarfItem = makeItemCard({ faction: "Dwarf" });
    const neutralItem = makeItemCard({ faction: "Neutral" });
    game.players.player1.deck = [dwarfItem, neutralItem];
    const card = searchItem({
      effectParams: { targetTypes: ["Item"], targetFaction: "Dwarf" },
    });
    const ids = getDeckSearchTargets(game, card).map((c) => c.id);
    expect(ids).toEqual([dwarfItem.id]);
  });

  it("is empty for a non-search card", () => {
    const game = newGame();
    game.players.player1.deck = [makeItemCard()];
    expect(getDeckSearchTargets(game, makeItemCard())).toHaveLength(0);
  });

  it("reads the active player's deck, not the opponent's", () => {
    const game = newGame();
    game.players.player1.deck = [];
    game.players.player2.deck = [makeItemCard()];
    expect(getDeckSearchTargets(game, searchItem())).toHaveLength(0);
  });
});
