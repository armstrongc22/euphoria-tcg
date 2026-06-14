/**
 * TEMPORARY_OUT_OF_PLAY_RESTORE (GILs Unit).
 *
 * A Neutral Item: pull one friendly Warrior off the field and hold it out of
 * play for 3 of the controller's turns. The Warrior keeps its identity and
 * attached Weapon while away (it never touches the Out Deck) and returns to
 * the field at full HEALTH, counting only the controller's Start Phases.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

/** Hands the turn back and forth so the controller (player1) starts again. */
function advanceToControllerNextTurn(game: GameState): GameState {
  let g = mustApply(game, { kind: "endTurn" });
  g = mustApply(g, { kind: "endTurn" });
  return g;
}

/**
 * Player 1, turn 1: a friendly Warrior (with optional overrides) is held out
 * of play by GILs Unit, targeting that Warrior.
 */
function gilsPlay(overrides: Parameters<typeof putWarriorOnField>[2] = {}) {
  let game = newGame();
  const warrior = putWarriorOnField(game, "player1", overrides);
  const card = realCard("gils-unit");
  game.players.player1.hand.push(card);
  game = mustApply(game, {
    kind: "playItem",
    cardId: card.id,
    targetInstanceId: warrior.instanceId,
  });
  return { game, warrior, card };
}

describe("TEMPORARY_OUT_OF_PLAY_RESTORE (GILs Unit)", () => {
  it("resolves with no pending marker", () => {
    const { game, card } = gilsPlay();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
  });

  it("removes the target from the field into outOfPlay (not the Out Deck)", () => {
    const { game, warrior } = gilsPlay();
    expect(
      game.players.player1.field.some((w) => w.instanceId === warrior.instanceId),
    ).toBe(false);
    // The spent Item goes to the Out Deck, but the held Warrior does not.
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(
      warrior.card.id,
    );
    expect(game.players.player1.outOfPlay).toHaveLength(1);
    expect(game.players.player1.outOfPlay[0]!.warrior.instanceId).toBe(
      warrior.instanceId,
    );
    expect(game.players.player1.outOfPlay[0]!.turnsRemaining).toBe(3);
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorSentOutOfPlay" &&
          e.instanceId === warrior.instanceId &&
          e.turnsRemaining === 3,
      ),
    ).toBe(true);
  });

  it("returns the Warrior to the field after 3 of the controller's turns", () => {
    let { game, warrior } = gilsPlay();
    game = advanceToControllerNextTurn(game); // player1 turn 3: 3 -> 2
    expect(game.players.player1.outOfPlay[0]!.turnsRemaining).toBe(2);
    expect(
      game.players.player1.field.some((w) => w.instanceId === warrior.instanceId),
    ).toBe(false);

    game = advanceToControllerNextTurn(game); // player1 turn 5: 2 -> 1
    expect(game.players.player1.outOfPlay[0]!.turnsRemaining).toBe(1);

    game = advanceToControllerNextTurn(game); // player1 turn 7: 1 -> 0, returns
    expect(game.players.player1.outOfPlay).toHaveLength(0);
    const returned = game.players.player1.field.find(
      (w) => w.instanceId === warrior.instanceId,
    );
    expect(returned).toBeDefined();
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorReturnedFromOutOfPlay" &&
          e.instanceId === warrior.instanceId,
      ),
    ).toBe(true);
  });

  it("does not count down on the opponent's turn", () => {
    let { game } = gilsPlay();
    game = mustApply(game, { kind: "endTurn" }); // player2 turn 2
    expect(game.players.player1.outOfPlay[0]!.turnsRemaining).toBe(3);
  });

  it("restores the returned Warrior to full HEALTH", () => {
    let { game, warrior } = gilsPlay({ currentHealth: 2000, maxHealth: 5000 });
    game = advanceToControllerNextTurn(game);
    game = advanceToControllerNextTurn(game);
    game = advanceToControllerNextTurn(game); // returns
    const returned = game.players.player1.field.find(
      (w) => w.instanceId === warrior.instanceId,
    )!;
    expect(returned.currentHealth).toBe(5000);
    expect(returned.attacksRemaining).toBe(1);
  });

  it("keeps the attached Weapon while away and on return (never to the Out Deck)", () => {
    const weapon = makeWeaponCard();
    let { game, warrior } = gilsPlay({ attachedWeapon: weapon });
    expect(game.players.player1.outOfPlay[0]!.warrior.attachedWeapon?.id).toBe(
      weapon.id,
    );
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(weapon.id);

    game = advanceToControllerNextTurn(game);
    game = advanceToControllerNextTurn(game);
    game = advanceToControllerNextTurn(game); // returns
    const returned = game.players.player1.field.find(
      (w) => w.instanceId === warrior.instanceId,
    )!;
    expect(returned.attachedWeapon?.id).toBe(weapon.id);
  });

  it("rejects an enemy target (friendly only)", () => {
    let game = newGame();
    const enemy = putWarriorOnField(game, "player2", {});
    const card = realCard("gils-unit");
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: enemy.instanceId,
    });
    // Item is spent, but the effect fails: enemy stays on the field, no hold.
    expect(
      game.players.player2.field.some((w) => w.instanceId === enemy.instanceId),
    ).toBe(true);
    expect(game.players.player1.outOfPlay).toHaveLength(0);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });
});
