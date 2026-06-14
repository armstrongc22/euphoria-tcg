/**
 * HALVE_OPPONENT_ATTACK_DAMAGE_NEXT_TURN (Bitter Guard).
 *
 * A Surfer Attack card: alongside its normal combat hit, it applies a status
 * that halves all of the opponent's combat damage on their next turn, then
 * expires at that turn's End Phase. Damage is reduced at strike time
 * (computeCombatDamage) — Warriors' ATTACK stats are never mutated.
 */
import { loadCards } from "@euphoria/card-data";
import { describe, expect, it } from "vitest";
import {
  createGame,
  defaultEffectRegistry,
  type GameState,
} from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

/**
 * Player 1, turn 3: a Surfer attacker plays Bitter Guard against a player2
 * defender, applying the halving status to player2 for their next turn.
 */
function playBitterGuard() {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    card: makeWarriorCard({ faction: "Surfer" }),
    currentAttack: 1000,
  });
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: 9000,
    maxHealth: 9000,
  });
  const card = realCard("bitter-guard");
  game.players.player1.spirit = 5;
  game.players.player1.hand.push(card);
  game = mustApply(game, { kind: "enterBattle" });
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
    selectedAttackCardId: card.id,
  });
  return { game, attacker, defender, card };
}

describe("HALVE_OPPONENT_ATTACK_DAMAGE_NEXT_TURN (Bitter Guard)", () => {
  it("1. has a registered effect handler (by code and by the real card)", () => {
    expect(defaultEffectRegistry.has("HALVE_OPPONENT_ATTACK_DAMAGE_NEXT_TURN")).toBe(
      true,
    );
    const card = realCard("bitter-guard");
    expect(card.effectCode).toBe("HALVE_OPPONENT_ATTACK_DAMAGE_NEXT_TURN");
    expect(defaultEffectRegistry.has(card.effectCode!)).toBe(true);
  });

  it("resolves cleanly and applies the status to the opponent for their turn", () => {
    const { game, card } = playBitterGuard();
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
    const status = game.statuses.find((s) => s.code === "HALVE_ATTACK_DAMAGE");
    expect(status).toBeDefined();
    expect(status!.affectedPlayer).toBe("player2");
    expect(status!.expiry).toEqual({
      player: "player2",
      timing: "endOfTurn",
      turnsRemaining: 1,
    });
    // Its own combat hit (player1's attack) lands at full strength: the
    // status only constrains the opponent.
    expect(
      game.events.some((e) => e.type === "warriorAttacked" && e.damage === 1000),
    ).toBe(true);
  });

  it("2. halves the opponent's combat damage during their next turn", () => {
    let { game } = playBitterGuard();
    const target = putWarriorOnField(game, "player1", {
      currentHealth: 9000,
      maxHealth: 9000,
    });
    const enemy = putWarriorOnField(game, "player2", { currentAttack: 4000 });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4 (status active)
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: target.instanceId,
    });
    // 4000 ATTACK is halved to 2000 of dealt damage.
    expect(
      result.players.player1.field.find((w) => w.instanceId === target.instanceId)!
        .currentHealth,
    ).toBe(7000); // 9000 - 2000
  });

  it("4. reduces dealt damage only — the attacker's ATTACK stat is untouched", () => {
    let { game } = playBitterGuard();
    const target = putWarriorOnField(game, "player1", {
      currentHealth: 9000,
      maxHealth: 9000,
    });
    const enemy = putWarriorOnField(game, "player2", { currentAttack: 4000 });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: target.instanceId,
    });
    expect(
      result.players.player2.field.find((w) => w.instanceId === enemy.instanceId)!
        .currentAttack,
    ).toBe(4000); // stat unchanged; only the strike was halved
  });

  it("3. expires at the opponent's End Phase, so later attacks are full again", () => {
    let { game } = playBitterGuard();
    const target = putWarriorOnField(game, "player1", {
      currentHealth: 9000,
      maxHealth: 9000,
    });
    const enemy = putWarriorOnField(game, "player2", { currentAttack: 4000 });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4 — halved window
    // End player2's turn: the status counts down and expires here.
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5
    expect(game.statuses.some((s) => s.code === "HALVE_ATTACK_DAMAGE")).toBe(false);

    game = mustApply(game, { kind: "endTurn" }); // player2, turn 6 — full again
    game = mustApply(game, { kind: "enterBattle" });
    const result = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: target.instanceId,
    });
    expect(
      result.players.player1.field.find((w) => w.instanceId === target.instanceId)!
        .currentHealth,
    ).toBe(5000); // 9000 - 4000 (no halving)
  });

  it("5. resolves safely in isolation without mutating the input state", () => {
    const before = toPlayer1Turn3(newGame());
    const card = realCard("bitter-guard");
    const statusesBefore = before.statuses.length;
    const resolution = defaultEffectRegistry.resolve(before, card, {
      player: "player1",
    });
    expect(resolution.outcome.resolved).toBe(true);
    // The registry clones: the input is untouched, only the returned state grows.
    expect(before.statuses).toHaveLength(statusesBefore);
    expect(
      resolution.state.statuses.some((s) => s.code === "HALVE_ATTACK_DAMAGE"),
    ).toBe(true);
  });

  it("6. no real card with an effectCode is left without a handler", () => {
    const unimplemented = loadCards()
      .filter((c) => c.effectCode !== undefined && c.effectCode !== "")
      .filter((c) => !defaultEffectRegistry.has(c.effectCode!))
      .map((c) => `${c.name} (${c.effectCode})`);
    expect(unimplemented).toEqual([]);
  });
});
