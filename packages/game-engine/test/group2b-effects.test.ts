/**
 * Group 2B-1: Out Deck target plumbing + REVIVE_WARRIOR, tested with the
 * real cards Totem's Creation and Bit Schneider from cards.json.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  defaultEffectRegistry,
  type GameState,
} from "../src/index";
import {
  makeDecks,
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

describe("REVIVE_WARRIOR via Totem's Creation", () => {
  it("revives a destroyed Warrior from the Out Deck to the field at full stats", () => {
    const game = newGame();
    const fallen = realCard("bit-schneider"); // Sonic Warrior, 1900/6500
    game.players.player1.outDeck.push(fallen);
    const item = realCard("totems-creation");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetOutDeckCardId: fallen.id,
    });

    const p1 = state.players.player1;
    expect(p1.spirit).toBe(1); // cost 1 paid
    expect(p1.field).toHaveLength(1);
    const revived = p1.field[0]!;
    expect(revived.card.id).toBe(fallen.id);
    expect(revived.currentAttack).toBe(1900);
    expect(revived.currentHealth).toBe(6500);
    expect(revived.maxHealth).toBe(6500);
    expect(revived.exhausted).toBe(false);
    // The Warrior left the Out Deck; only the used Item remains there.
    expect(p1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      state.events.some(
        (e) => e.type === "warriorRevived" && e.cardId === fallen.id,
      ),
    ).toBe(true);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === item.id),
    ).toBe(true);
  });

  it("gives the revived Warrior a fresh, unique instance id", () => {
    const game = newGame();
    const onField = putWarriorOnField(game, "player1");
    game.players.player1.outDeck.push(realCard("bit-schneider"));
    const item = realCard("totems-creation");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetOutDeckCardId: "sonic_warrior_bit_schneider",
    });

    const ids = state.players.player1.field.map((w) => w.instanceId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(onField.instanceId);
  });

  it("fails safely when targetOutDeckCardId is missing", () => {
    const game = newGame();
    const fallen = realCard("bit-schneider");
    game.players.player1.outDeck.push(fallen);
    const item = realCard("totems-creation");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(state.players.player1.field).toHaveLength(0);
    // Item spent per current behavior; Warrior still in the Out Deck.
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      fallen.id,
      item.id,
    ]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("fails safely for a card id that is not in the Out Deck", () => {
    const game = newGame();
    const item = realCard("totems-creation");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetOutDeckCardId: "ghost",
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
      expect(outcome.reason).toContain("Out Deck");
    }
    expect(state).toBe(game); // untouched input returned
  });

  it("rejects non-Warrior cards in the Out Deck as revive targets", () => {
    const game = newGame();
    const usedItem = realCard("gunder-love"); // an Item in the Out Deck
    game.players.player1.outDeck.push(usedItem);
    const item = realCard("totems-creation");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetOutDeckCardId: usedItem.id,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("not a Warrior");
    }
    expect(state).toBe(game);
    expect(game.players.player1.outDeck.map((c) => c.id)).toEqual([usedItem.id]);
  });

  it("enforces the 5-Warrior field limit", () => {
    const game = newGame();
    for (let i = 0; i < 5; i++) putWarriorOnField(game, "player1");
    const fallen = realCard("bit-schneider");
    game.players.player1.outDeck.push(fallen);
    const item = realCard("totems-creation");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetOutDeckCardId: fallen.id,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("full");
    }
    expect(state).toBe(game);
    expect(game.players.player1.field).toHaveLength(5);
    expect(game.players.player1.outDeck.map((c) => c.id)).toEqual([fallen.id]);
  });

  it("cannot revive out of the opponent's Out Deck", () => {
    const game = newGame();
    const fallen = realCard("bit-schneider");
    game.players.player2.outDeck.push(fallen); // opponent's Out Deck
    const item = realCard("totems-creation");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetOutDeckCardId: fallen.id,
    });

    expect(outcome.resolved).toBe(false);
    expect(state).toBe(game);
    expect(game.players.player2.outDeck.map((c) => c.id)).toEqual([fallen.id]);
  });
});
