/**
 * Core rule: one normal Warrior summon (the playWarrior action) per player per
 * turn. Covers the legal-action gate, the applyAction rejection, the per-turn
 * reset, that non-Warrior plays don't consume the summon, and that the limit
 * applies to whichever player is active (so the AI obeys it through the same
 * legal-action path).
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameState,
} from "../src/index";
import {
  makeDecks,
  makeItemCard,
  makeWarriorCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
} from "./helpers";

/** Fresh game in P1's turn-1 Main Phase. */
function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

const warriorSummons = (state: GameState): number =>
  getLegalActions(state).filter((a) => a.kind === "playWarrior").length;

describe("one Warrior summon per turn", () => {
  it("lets a player summon one Warrior on their turn", () => {
    const game = newGame();
    game.players.player1.spirit = 5;
    const a = makeWarriorCard();
    game.players.player1.hand.push(a);

    const after = mustApply(game, { kind: "playWarrior", cardId: a.id });
    expect(after.players.player1.field).toHaveLength(1);
    expect(after.players.player1.warriorSummonsUsedThisTurn).toBe(1);
  });

  it("does not offer a second Warrior summon in getLegalActions", () => {
    const game = newGame();
    game.players.player1.spirit = 5;
    const a = makeWarriorCard();
    const b = makeWarriorCard();
    game.players.player1.hand.push(a, b);

    expect(warriorSummons(game)).toBeGreaterThan(0);
    const after = mustApply(game, { kind: "playWarrior", cardId: a.id });
    // A second Warrior is still in hand and affordable, but no longer offered.
    expect(after.players.player1.hand.some((c) => c.id === b.id)).toBe(true);
    expect(after.players.player1.spirit).toBeGreaterThanOrEqual(b.cost);
    expect(warriorSummons(after)).toBe(0);
  });

  it("rejects an illegal second summon via applyAction (SUMMON_LIMIT_REACHED)", () => {
    const game = newGame();
    game.players.player1.spirit = 5;
    const a = makeWarriorCard();
    const b = makeWarriorCard();
    game.players.player1.hand.push(a, b);

    const after = mustApply(game, { kind: "playWarrior", cardId: a.id });
    const result = applyAction(after, { kind: "playWarrior", cardId: b.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SUMMON_LIMIT_REACHED");
    // State is unchanged: still just the one Warrior.
    expect(after.players.player1.field).toHaveLength(1);
  });

  it("resets the summon allowance on the player's next turn", () => {
    const game = newGame();
    game.players.player1.spirit = 9;
    const a = makeWarriorCard();
    const b = makeWarriorCard();
    game.players.player1.hand.push(a, b);

    let state = mustApply(game, { kind: "playWarrior", cardId: a.id });
    expect(warriorSummons(state)).toBe(0);
    // P1 ends turn → P2 start/main → P2 ends turn → back to P1's next turn.
    state = mustApply(state, { kind: "endTurn" });
    state = mustApply(state, { kind: "endTurn" });
    expect(state.activePlayer).toBe("player1");
    expect(state.players.player1.warriorSummonsUsedThisTurn).toBe(0);
    expect(warriorSummons(state)).toBeGreaterThan(0);
    const after = mustApply(state, { kind: "playWarrior", cardId: b.id });
    expect(after.players.player1.field).toHaveLength(2);
  });

  it("does not consume the summon when playing an Item", () => {
    const game = newGame();
    game.players.player1.spirit = 9;
    const item = makeItemCard();
    const w = makeWarriorCard();
    game.players.player1.hand.push(item, w);

    const after = mustApply(game, { kind: "playItem", cardId: item.id });
    expect(after.players.player1.warriorSummonsUsedThisTurn).toBe(0);
    expect(warriorSummons(after)).toBeGreaterThan(0);
    const summoned = mustApply(after, { kind: "playWarrior", cardId: w.id });
    expect(summoned.players.player1.field).toHaveLength(1);
  });

  it("does not consume the summon when equipping a Weapon", () => {
    const game = newGame();
    game.players.player1.spirit = 9;
    const target = putWarriorOnField(game, "player1");
    const weapon = makeWeaponCard();
    const w = makeWarriorCard();
    game.players.player1.hand.push(weapon, w);

    const after = mustApply(game, {
      kind: "equipWeapon",
      cardId: weapon.id,
      warriorInstanceId: target.instanceId,
    });
    expect(after.players.player1.warriorSummonsUsedThisTurn).toBe(0);
    const summoned = mustApply(after, { kind: "playWarrior", cardId: w.id });
    // The pre-placed Warrior plus the freshly summoned one.
    expect(summoned.players.player1.field).toHaveLength(2);
  });

  it("applies the same limit to player2 (so the AI obeys it too)", () => {
    const game = newGame();
    // Hand the turn to player2.
    const p2turn = mustApply(game, { kind: "endTurn" });
    expect(p2turn.activePlayer).toBe("player2");
    p2turn.players.player2.spirit = 5;
    const a = makeWarriorCard();
    const b = makeWarriorCard();
    p2turn.players.player2.hand.push(a, b);

    expect(warriorSummons(p2turn)).toBeGreaterThan(0);
    const after = mustApply(p2turn, { kind: "playWarrior", cardId: a.id });
    expect(warriorSummons(after)).toBe(0);
    const result = applyAction(after, { kind: "playWarrior", cardId: b.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SUMMON_LIMIT_REACHED");
  });
});
