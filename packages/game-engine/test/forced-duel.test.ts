/**
 * FORCED_DUEL (Trial of Gia).
 *
 * A Neutral Item locking one friendly and one enemy Warrior into a duel:
 * each may only attack the other (no other target, no direct attack) until
 * one is destroyed, at which point the lock is removed. The engine restricts
 * legal actions rather than auto-forcing them, so the duel is enforced as a
 * mutual attack-target lock.
 */
import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalActions, type GameState } from "../src/index";
import { makeDecks, mustApply, putWarriorOnField, realCard } from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/** Declare a plain (no Attack card) combat attack, returning the raw result. */
function attack(game: GameState, attackerId: string, defenderId: string) {
  return applyAction(game, {
    kind: "attack",
    attackerInstanceId: attackerId,
    defenderInstanceId: defenderId,
  });
}

/**
 * Player 1, turn 3, Main Phase: a friendly Warrior (5000 ATTACK) is dueled
 * against one enemy partner, with a tougher enemy bystander on the field for
 * negative targeting checks.
 */
function setupDuel() {
  let game = toPlayer1Turn3(newGame());
  const friendly = putWarriorOnField(game, "player1", { currentAttack: 5000 });
  const partner = putWarriorOnField(game, "player2", {
    currentHealth: 3000,
    maxHealth: 3000,
  });
  const bystander = putWarriorOnField(game, "player2", {
    currentHealth: 9000,
    maxHealth: 9000,
  });
  const card = realCard("trial-of-gia");
  game.players.player1.hand.push(card);
  game = mustApply(game, {
    kind: "playItem",
    cardId: card.id,
    targetInstanceId: friendly.instanceId,
    secondaryTargetInstanceId: partner.instanceId,
  });
  return { game, friendly, partner, bystander, card };
}

describe("FORCED_DUEL (Trial of Gia)", () => {
  it("resolves with no pending marker and applies a persistent FORCED_DUEL status", () => {
    const { game, friendly, partner, card } = setupDuel();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
    const duel = game.statuses.find((s) => s.code === "FORCED_DUEL");
    expect(duel).toBeDefined();
    expect(duel!.affectedInstanceId).toBe(friendly.instanceId);
    expect(duel!.metadata?.opponentInstanceId).toBe(partner.instanceId);
    expect(duel!.expiry).toBeUndefined(); // persists until a duelist dies
  });

  it("lets the dueling Warrior attack its partner", () => {
    let { game, friendly, partner } = setupDuel();
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: friendly.instanceId,
      defenderInstanceId: partner.instanceId,
    });
    // 5000 ATTACK destroys the 3000-HEALTH partner, ending the duel.
    expect(
      result.players.player2.field.some((w) => w.instanceId === partner.instanceId),
    ).toBe(false);
    expect(result.statuses.some((s) => s.code === "FORCED_DUEL")).toBe(false);
  });

  it("forbids the dueling Warrior from attacking a different enemy", () => {
    let { game, friendly, bystander } = setupDuel();
    game = mustApply(game, { kind: "enterBattle" });
    const result = attack(game, friendly.instanceId, bystander.instanceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORCED_DUEL_TARGET");
  });

  it("leaves non-dueling Warriors free to attack any enemy", () => {
    let { game, bystander } = setupDuel();
    const freeAttacker = putWarriorOnField(game, "player1", { currentAttack: 1000 });
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: freeAttacker.instanceId,
      defenderInstanceId: bystander.instanceId,
    });
    expect(
      result.players.player2.field.find((w) => w.instanceId === bystander.instanceId)!
        .currentHealth,
    ).toBe(8000); // 9000 - 1000
  });

  it("only offers the partner as a legal target for the dueling attacker", () => {
    let { game, friendly, partner } = setupDuel();
    game = mustApply(game, { kind: "enterBattle" });
    const duelistAttacks = getLegalActions(game).filter(
      (a) => a.kind === "attack" && a.attackerInstanceId === friendly.instanceId,
    );
    expect(duelistAttacks.length).toBeGreaterThan(0);
    for (const a of duelistAttacks) {
      expect((a as { defenderInstanceId: string }).defenderInstanceId).toBe(
        partner.instanceId,
      );
    }
    expect(
      getLegalActions(game).some(
        (a) =>
          a.kind === "directAttack" && a.attackerInstanceId === friendly.instanceId,
      ),
    ).toBe(false);
  });

  it("locks the enemy duelist to the friendly duelist on the opponent's turn", () => {
    let { game, friendly, partner, bystander } = setupDuel();
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4, Main
    game = mustApply(game, { kind: "enterBattle" });

    // partner -> a non-duelist friendly (the bystander's controller is the
    // active player now, so player1's Warriors are the targets) is rejected,
    // while partner -> friendly duelist is allowed.
    const extraFriendly = putWarriorOnField(game, "player1", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    void bystander;
    const bad = attack(game, partner.instanceId, extraFriendly.instanceId);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("FORCED_DUEL_TARGET");

    const good = attack(game, partner.instanceId, friendly.instanceId);
    expect(good.ok).toBe(true);
  });

  it("ends the duel when one duelist is destroyed, freeing the survivor", () => {
    let { game, friendly, partner, bystander } = setupDuel();
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: friendly.instanceId,
      defenderInstanceId: partner.instanceId,
    }); // partner destroyed, duel over
    expect(game.statuses.some((s) => s.code === "FORCED_DUEL")).toBe(false);

    // On the survivor's next turn it can hit the bystander freely (no lock).
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: friendly.instanceId,
      defenderInstanceId: bystander.instanceId,
    });
    expect(
      result.players.player2.field.find((w) => w.instanceId === bystander.instanceId)!
        .currentHealth,
    ).toBe(4000); // 9000 - 5000
  });

  it("rejects targets that are not one friendly and one enemy", () => {
    let game = toPlayer1Turn3(newGame());
    const a = putWarriorOnField(game, "player1", {});
    const b = putWarriorOnField(game, "player1", {}); // both friendly
    const card = realCard("trial-of-gia");
    game.players.player1.hand.push(card);
    game = mustApply(game, {
      kind: "playItem",
      cardId: card.id,
      targetInstanceId: a.instanceId,
      secondaryTargetInstanceId: b.instanceId,
    });
    expect(game.statuses.some((s) => s.code === "FORCED_DUEL")).toBe(false);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
  });
});
