import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalActions } from "../src/index";
import { makeDecks, mustApply } from "./helpers";

describe("phase gates", () => {
  it("enters Battle Phase from Main Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const next = mustApply(game, { kind: "enterBattle" });

    expect(next.phase).toBe("battle");
    expect(
      next.events.some((e) => e.type === "phaseChanged" && e.phase === "battle"),
    ).toBe(true);
  });

  it("cannot enter Battle Phase when already in Battle Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const inBattle = mustApply(game, { kind: "enterBattle" });

    const result = applyAction(inBattle, { kind: "enterBattle" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WRONG_PHASE");
    }
  });

  it("Battle Phase is one-way: no action returns to Main Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const inBattle = mustApply(game, { kind: "enterBattle" });

    expect(getLegalActions(inBattle)).toEqual([{ kind: "endTurn" }]);
  });

  it("can end the turn from Battle Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const inBattle = mustApply(game, { kind: "enterBattle" });
    const next = mustApply(inBattle, { kind: "endTurn" });

    expect(next.turn).toBe(2);
    expect(next.activePlayer).toBe("player2");
    expect(next.phase).toBe("main");
  });

  it("offers enterBattle and endTurn in Main Phase", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    expect(getLegalActions(game)).toEqual([
      { kind: "enterBattle" },
      { kind: "endTurn" },
    ]);
  });

  it("rejects not-yet-implemented actions with NOT_IMPLEMENTED", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const result = applyAction(game, {
      kind: "playWarrior",
      cardId: "anything",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_IMPLEMENTED");
    }
  });

  it("rejects every action and offers none once a winner is set", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.winner = "player1";

    const result = applyAction(game, { kind: "endTurn" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GAME_OVER");
    }
    expect(getLegalActions(game)).toEqual([]);
  });
});
