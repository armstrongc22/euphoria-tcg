import { describe, expect, it } from "vitest";
import { createGame } from "../src/index";
import { makeDecks, mustApply, putWarriorOnField } from "./helpers";

const endTurn = { kind: "endTurn" } as const;

describe("turn lifecycle", () => {
  it("gains Spirit before drawing in the Start Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const spiritIndex = game.events.findIndex(
      (e) => e.type === "spiritGained" && e.player === "player1",
    );
    const drawIndex = game.events.findIndex(
      (e) => e.type === "cardDrawn" && e.player === "player1",
    );

    expect(spiritIndex).toBeGreaterThanOrEqual(0);
    expect(drawIndex).toBeGreaterThan(spiritIndex);
  });

  it("endTurn hands the turn to Player 2 and runs their Start Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const next = mustApply(game, endTurn);

    expect(next.turn).toBe(2);
    expect(next.activePlayer).toBe("player2");
    expect(next.phase).toBe("main");
    expect(next.players.player2.spirit).toBe(2);
    expect(next.players.player2.hand).toHaveLength(6);
  });

  it("applyAction never mutates the input state", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    mustApply(game, endTurn);

    expect(game.turn).toBe(1);
    expect(game.activePlayer).toBe("player1");
    expect(game.players.player2.hand).toHaveLength(5);
    expect(game.players.player2.spirit).toBe(1);
  });

  it("accumulates unspent Spirit across turns", () => {
    let state = createGame({ decks: makeDecks(), seed: 1 });
    state = mustApply(state, endTurn); // turn 2, player2
    state = mustApply(state, endTurn); // turn 3, player1

    expect(state.turn).toBe(3);
    expect(state.players.player1.spirit).toBe(3); // 2 unspent + 1 gained
    expect(state.players.player1.hand).toHaveLength(7);
    expect(state.players.player1.deck).toHaveLength(23);
  });

  it("refreshes spent Warriors to one attack at the start of the owner's turn", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    putWarriorOnField(game, "player2", { attacksRemaining: 0 });

    const next = mustApply(game, endTurn);
    expect(next.players.player2.field[0]?.attacksRemaining).toBe(1);
  });

  it("resets the direct-attack flag at the start of the owner's turn", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player2.directAttackUsedThisTurn = true;

    const next = mustApply(game, endTurn);
    expect(next.players.player2.directAttackUsedThisTurn).toBe(false);
  });

  it("expires temporary attack buffs at the start of the owner's next turn", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    putWarriorOnField(game, "player2", {
      currentAttack: 1500, // base 1000 + 500 buff
      temporaryAttackBuffs: [{ amount: 500 }],
    });

    const next = mustApply(game, endTurn);
    const warrior = next.players.player2.field[0];
    expect(warrior?.currentAttack).toBe(1000);
    expect(warrior?.temporaryAttackBuffs).toEqual([]);
    expect(next.events.some((e) => e.type === "buffExpired")).toBe(true);
  });

  it("resolves due delayed Spirit effects before the turn Spirit gain", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player2.delayedEffects.push({
      type: "gainSpirit",
      amount: 3,
      turnsRemaining: 1,
    });

    const next = mustApply(game, endTurn);
    expect(next.players.player2.spirit).toBe(5); // 1 + 3 delayed + 1 turn gain
    expect(next.players.player2.delayedEffects).toEqual([]);
  });

  it("counts down delayed effects that are not due yet", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player2.delayedEffects.push({
      type: "gainSpirit",
      amount: 3,
      turnsRemaining: 3,
    });

    const next = mustApply(game, endTurn);
    expect(next.players.player2.spirit).toBe(2); // turn gain only
    expect(next.players.player2.delayedEffects).toEqual([
      { type: "gainSpirit", amount: 3, turnsRemaining: 2 },
    ]);
  });

  it("treats drawing from an empty deck as a no-op (deck-out loss is a rule to revisit)", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player2.deck = [];

    const next = mustApply(game, endTurn);
    expect(next.players.player2.hand).toHaveLength(5);
    expect(next.players.player2.spirit).toBe(2);
    expect(next.winner).toBeNull();
    expect(
      next.events.some(
        (e) => e.type === "drawFailedDeckEmpty" && e.player === "player2",
      ),
    ).toBe(true);
  });
});
