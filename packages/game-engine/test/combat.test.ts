import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameAction,
  type GameState,
  type WarriorInPlay,
} from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
} from "./helpers";

function expectError(state: GameState, action: GameAction, code: string): void {
  const result = applyAction(state, action);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

/**
 * Turn 2, Player 2 active, still in Main Phase so tests can adjust the
 * board before entering battle. Attacks are legal from turn 2 on.
 */
function turnTwo(): GameState {
  const game = createGame({ decks: makeDecks(), seed: 1 });
  return mustApply(game, { kind: "endTurn" });
}

function attack(attacker: WarriorInPlay, defender: WarriorInPlay): GameAction {
  return {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: defender.instanceId,
  };
}

describe("Warrior vs Warrior combat", () => {
  it("deals damage equal to the attacker's attack, with no counter damage", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", { currentAttack: 800 });
    const defender = putWarriorOnField(game, "player1", {
      currentAttack: 9999, // would kill on counter — must not matter
      currentHealth: 2000,
    });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender));

    const survivingDefender = state.players.player1.field[0]!;
    expect(survivingDefender.currentHealth).toBe(1200); // 2000 - 800
    const survivingAttacker = state.players.player2.field[0]!;
    expect(survivingAttacker.currentHealth).toBe(attacker.currentHealth);
    expect(survivingAttacker.attacksRemaining).toBe(0);
    expect(
      state.events.some(
        (e) => e.type === "warriorAttacked" && e.damage === 800,
      ),
    ).toBe(true);
  });

  it("destroys a defender at exactly 0 health and moves it to the Out Deck", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", { currentAttack: 2000 });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 2000 });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender));

    expect(state.players.player1.field).toHaveLength(0);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      defender.card.id,
    ]);
    expect(
      state.events.some(
        (e) =>
          e.type === "warriorDestroyed" && e.instanceId === defender.instanceId,
      ),
    ).toBe(true);
  });

  it("destroys a defender driven below 0 health", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 500 });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender));

    expect(state.players.player1.field).toHaveLength(0);
    expect(state.players.player1.outDeck).toHaveLength(1);
  });

  it("sends the defender's attached Weapon to the Out Deck with it", () => {
    const game = turnTwo();
    const weapon = makeWeaponCard();
    const attacker = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const defender = putWarriorOnField(game, "player1", {
      currentHealth: 1000,
      attachedWeapon: weapon,
    });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender));

    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      defender.card.id,
      weapon.id,
    ]);
    expect(
      state.events.some(
        (e) => e.type === "weaponDestroyed" && e.cardId === weapon.id,
      ),
    ).toBe(true);
  });

  it("prevents the same Warrior from attacking twice in one turn", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", { currentAttack: 100 });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(attacker, defender));

    expectError(state, attack(attacker, defender), "WARRIOR_EXHAUSTED");
  });

  it("lets multiple different Warriors attack in the same turn", () => {
    const game = turnTwo();
    const first = putWarriorOnField(game, "player2", { currentAttack: 100 });
    const second = putWarriorOnField(game, "player2", { currentAttack: 200 });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, attack(first, defender));
    state = mustApply(state, attack(second, defender));

    expect(state.players.player1.field[0]?.currentHealth).toBe(8700);
  });

  it("lets a Warrior attack the turn it is summoned", () => {
    const game = turnTwo();
    const card = makeWarriorCard({ attack: 600 });
    game.players.player2.hand.push(card);
    const defender = putWarriorOnField(game, "player1", { currentHealth: 2000 });

    let state = mustApply(game, { kind: "playWarrior", cardId: card.id });
    const summoned = state.players.player2.field[0]!;
    state = mustApply(state, { kind: "enterBattle" });
    state = mustApply(state, attack(summoned, defender));

    expect(state.players.player1.field[0]?.currentHealth).toBe(1400);
  });

  it("rejects attacks outside Battle Phase", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    const defender = putWarriorOnField(game, "player1");

    expectError(game, attack(attacker, defender), "WRONG_PHASE");
  });

  it("rejects all attacks on the first turn of the game", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 }); // turn 1, P1
    const attacker = putWarriorOnField(game, "player1");
    const defender = putWarriorOnField(game, "player2");
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(state, attack(attacker, defender), "FIRST_TURN_NO_ATTACKS");
  });

  it("rejects an attacker or defender that is not on the field", () => {
    const game = turnTwo();
    const mine = putWarriorOnField(game, "player2");
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      { kind: "attack", attackerInstanceId: "ghost", defenderInstanceId: mine.instanceId },
      "WARRIOR_NOT_FOUND",
    );
    expectError(
      state,
      { kind: "attack", attackerInstanceId: mine.instanceId, defenderInstanceId: "ghost" },
      "WARRIOR_NOT_FOUND",
    );
  });

  it("rejects attacking your own Warrior", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    const friendly = putWarriorOnField(game, "player2");
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(state, attack(attacker, friendly), "WARRIOR_NOT_FOUND");
  });

});

describe("direct attacks", () => {
  it("reduces opponent lives by 1 when they control no Warriors", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(state.players.player1.lives).toBe(2);
    expect(state.players.player2.directAttackUsedThisTurn).toBe(true);
    expect(state.players.player2.field[0]?.attacksRemaining).toBe(0);
    expect(
      state.events.some(
        (e) => e.type === "directAttacked" && e.livesRemaining === 2,
      ),
    ).toBe(true);
  });

  it("is rejected while the opponent controls a Warrior", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    putWarriorOnField(game, "player1");
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      { kind: "directAttack", attackerInstanceId: attacker.instanceId },
      "OPPONENT_HAS_WARRIORS",
    );
  });

  it("allows only one direct attack per turn even with multiple Warriors", () => {
    const game = turnTwo();
    const first = putWarriorOnField(game, "player2");
    const second = putWarriorOnField(game, "player2");
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: first.instanceId,
    });

    expectError(
      state,
      { kind: "directAttack", attackerInstanceId: second.instanceId },
      "DIRECT_ATTACK_LIMIT",
    );
  });

  it("allows another direct attack on the owner's next turn", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });
    state = mustApply(state, { kind: "endTurn" }); // turn 3, P1
    state = mustApply(state, { kind: "endTurn" }); // turn 4, P2
    state = mustApply(state, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(state.players.player1.lives).toBe(1);
  });

  it("is rejected on the first turn of the game", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 }); // turn 1, P1
    const attacker = putWarriorOnField(game, "player1");
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      { kind: "directAttack", attackerInstanceId: attacker.instanceId },
      "FIRST_TURN_NO_ATTACKS",
    );
  });

  it("is rejected for a Warrior with no attacks remaining", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", { attacksRemaining: 0 });
    const state = mustApply(game, { kind: "enterBattle" });

    expectError(
      state,
      { kind: "directAttack", attackerInstanceId: attacker.instanceId },
      "WARRIOR_EXHAUSTED",
    );
  });

  it("sets the winner at 0 lives and blocks all further actions", () => {
    const game = turnTwo();
    game.players.player1.lives = 1;
    const attacker = putWarriorOnField(game, "player2");
    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(state.players.player1.lives).toBe(0);
    expect(state.winner).toBe("player2");
    expect(
      state.events.some((e) => e.type === "gameWon" && e.winner === "player2"),
    ).toBe(true);
    expectError(state, { kind: "endTurn" }, "GAME_OVER");
    expect(getLegalActions(state)).toEqual([]);
  });
});

describe("getLegalActions in Battle Phase", () => {
  it("enumerates attacker/defender pairs, skipping spent Warriors", () => {
    const game = turnTwo();
    const fresh = putWarriorOnField(game, "player2");
    const tired = putWarriorOnField(game, "player2", { attacksRemaining: 0 });
    const defenderA = putWarriorOnField(game, "player1");
    const defenderB = putWarriorOnField(game, "player1");
    const state = mustApply(game, { kind: "enterBattle" });

    const actions = getLegalActions(state);
    expect(actions).toContainEqual(attack(fresh, defenderA));
    expect(actions).toContainEqual(attack(fresh, defenderB));
    expect(
      actions.some(
        (a) => a.kind === "attack" && a.attackerInstanceId === tired.instanceId,
      ),
    ).toBe(false);
    expect(actions.some((a) => a.kind === "directAttack")).toBe(false);
  });

  it("offers directAttack only while unused and the opponent field is empty", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2");
    const state = mustApply(game, { kind: "enterBattle" });

    expect(getLegalActions(state)).toContainEqual({
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    const after = mustApply(state, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });
    expect(after.players.player2.field.some((w) => w.attacksRemaining > 0)).toBe(false);
    expect(getLegalActions(after).some((a) => a.kind === "directAttack")).toBe(
      false,
    );
  });

  it("offers no attacks on turn 1", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    putWarriorOnField(game, "player1");
    putWarriorOnField(game, "player2");
    const state = mustApply(game, { kind: "enterBattle" });

    const actions = getLegalActions(state);
    expect(actions.some((a) => a.kind === "attack")).toBe(false);
    expect(actions.some((a) => a.kind === "directAttack")).toBe(false);
  });
});
