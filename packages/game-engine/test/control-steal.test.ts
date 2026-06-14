/**
 * CONTROL_STEAL (Coerced Loyalty).
 *
 * A Neutral Item: take control of one enemy Warrior — it moves to the
 * controller's field and fights for them. Its original owner may reclaim it
 * on their own Main Phase by paying a 5000-HEALTH buyback (dealt to the
 * Warrior, which may destroy it). A stolen Warrior destroyed in combat
 * returns its card to its original owner's Out Deck.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameState,
} from "../src/index";
import { makeDecks, mustApply, putWarriorOnField, realCard } from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

function findWarrior(game: GameState, instanceId: string) {
  for (const p of ["player1", "player2"] as const) {
    const w = game.players[p].field.find((x) => x.instanceId === instanceId);
    if (w !== undefined) return { warrior: w, owner: p };
  }
  return undefined;
}

/** Player 1, turn 3, Main Phase: player1 steals a player2 Warrior. */
function steal(targetOverrides: Parameters<typeof putWarriorOnField>[2] = {}) {
  let game = toPlayer1Turn3(newGame());
  const victim = putWarriorOnField(game, "player2", {
    currentAttack: 2000,
    currentHealth: 6000,
    maxHealth: 6000,
    ...targetOverrides,
  });
  const card = realCard("coerced-loyalty");
  game.players.player1.hand.push(card);
  game = mustApply(game, {
    kind: "playItem",
    cardId: card.id,
    targetInstanceId: victim.instanceId,
  });
  return { game, victim, card };
}

describe("CONTROL_STEAL (Coerced Loyalty)", () => {
  it("moves the Warrior to the controller's field with steal bookkeeping", () => {
    const { game, victim, card } = steal();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
    expect(
      game.players.player2.field.some((w) => w.instanceId === victim.instanceId),
    ).toBe(false);
    const stolen = game.players.player1.field.find(
      (w) => w.instanceId === victim.instanceId,
    );
    expect(stolen).toBeDefined();
    expect(stolen!.stolenFrom).toBe("player2");
    expect(stolen!.stealBuybackDamage).toBe(5000);
    expect(stolen!.attacksRemaining).toBe(1); // fights for the thief this turn
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorControlStolen" &&
          e.player === "player1" &&
          e.fromPlayer === "player2",
      ),
    ).toBe(true);
  });

  it("lets the thief attack with the stolen Warrior the turn it is taken", () => {
    let { game, victim } = steal({ currentAttack: 2000 });
    const enemy = putWarriorOnField(game, "player2", {
      currentHealth: 9000,
      maxHealth: 9000,
    });
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: victim.instanceId,
      defenderInstanceId: enemy.instanceId,
    });
    expect(
      result.players.player2.field.find((w) => w.instanceId === enemy.instanceId)!
        .currentHealth,
    ).toBe(7000); // 9000 - 2000
  });

  it("offers reclaim to the original owner on their Main Phase", () => {
    let { game, victim } = steal();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4, Main
    const reclaim = getLegalActions(game).find(
      (a) => a.kind === "reclaimWarrior",
    );
    expect(reclaim).toEqual({
      kind: "reclaimWarrior",
      warriorInstanceId: victim.instanceId,
    });
    // It is not offered to the thief on their own turn.
    const thiefTurn = mustApply(game, { kind: "endTurn" }); // player1, turn 5
    expect(
      getLegalActions(thiefTurn).some((a) => a.kind === "reclaimWarrior"),
    ).toBe(false);
  });

  it("reclaims the Warrior for 5000 HEALTH when it survives the buyback", () => {
    let { game, victim } = steal({ currentHealth: 6000, maxHealth: 6000 });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, {
      kind: "reclaimWarrior",
      warriorInstanceId: victim.instanceId,
    });
    const back = findWarrior(game, victim.instanceId);
    expect(back?.owner).toBe("player2");
    expect(back!.warrior.currentHealth).toBe(1000); // 6000 - 5000
    expect(back!.warrior.stolenFrom).toBeUndefined();
    expect(back!.warrior.stealBuybackDamage).toBeUndefined();
  });

  it("destroys the Warrior if the buyback is lethal, to its owner's Out Deck", () => {
    let { game, victim } = steal({ currentHealth: 4000, maxHealth: 4000 });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, {
      kind: "reclaimWarrior",
      warriorInstanceId: victim.instanceId,
    });
    expect(findWarrior(game, victim.instanceId)).toBeUndefined();
    expect(game.players.player2.outDeck.map((c) => c.id)).toContain(victim.card.id);
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(
      victim.card.id,
    );
  });

  it("returns the card to its original owner when destroyed in combat", () => {
    let { game, victim } = steal({ currentAttack: 1000, currentHealth: 1000, maxHealth: 1000 });
    // player2's turn: the owner attacks their own stolen Warrior to kill it.
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    const killer = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: killer.instanceId,
      defenderInstanceId: victim.instanceId,
    });
    expect(findWarrior(game, victim.instanceId)).toBeUndefined();
    // Its card goes to player2's Out Deck (original owner), not player1's.
    expect(game.players.player2.outDeck.map((c) => c.id)).toContain(victim.card.id);
    expect(game.players.player1.outDeck.map((c) => c.id)).not.toContain(
      victim.card.id,
    );
  });

  it("cannot steal into a full Warrior field", () => {
    let game = toPlayer1Turn3(newGame());
    for (let i = 0; i < game.config.warriorSlots; i++) {
      putWarriorOnField(game, "player1", {});
    }
    const victim = putWarriorOnField(game, "player2", {});
    const card = realCard("coerced-loyalty");
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: victim.instanceId,
    });
    // The steal fails: the victim stays with player2 and is not contested.
    const found = findWarrior(game, victim.instanceId);
    expect(found?.owner).toBe("player2");
    expect(found!.warrior.stolenFrom).toBeUndefined();
    expect(game.players.player1.field).toHaveLength(game.config.warriorSlots);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });

  it("cannot reclaim into a full Warrior field", () => {
    let { game, victim } = steal();
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4, Main
    // Fill player2's field to the cap (the stolen Warrior sits on player1's).
    while (game.players.player2.field.length < game.config.warriorSlots) {
      putWarriorOnField(game, "player2", {});
    }
    expect(getLegalActions(game).some((a) => a.kind === "reclaimWarrior")).toBe(
      false,
    );
    const result = applyAction(game, {
      kind: "reclaimWarrior",
      warriorInstanceId: victim.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FIELD_FULL");
  });

  it("rejects stealing a friendly Warrior", () => {
    let game = toPlayer1Turn3(newGame());
    const friendly = putWarriorOnField(game, "player1", {});
    const card = realCard("coerced-loyalty");
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: friendly.instanceId,
    });
    expect(game.players.player1.field.find((w) => w.instanceId === friendly.instanceId)!
      .stolenFrom).toBeUndefined();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });

  it("rejects reclaim by a player who does not own the stolen Warrior", () => {
    const { game, victim } = steal();
    // It is player1's turn (the thief); player1 cannot reclaim player2's Warrior.
    const result = applyAction(game, {
      kind: "reclaimWarrior",
      warriorInstanceId: victim.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WARRIOR_NOT_FOUND");
  });
});
