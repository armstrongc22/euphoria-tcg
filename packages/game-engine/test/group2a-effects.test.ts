/**
 * Group 2A: target-selection plumbing + the simplest targeted effects,
 * tested with real cards (Megawatt Apocalypse, Guatavita, Dante's
 * Lamentation, Gunder Love) where they exist. DAMAGE_TARGET has no real
 * card yet, so its side rule is tested at the registry level.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  defaultEffectRegistry,
  type GameState,
} from "../src/index";
import {
  makeAttackCard,
  makeDecks,
  makeWarriorCard,
  makeWeaponCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

/** Turn 2, Player 2 active in Main Phase, empty hand, 2 Spirit. */
function turnTwo(): GameState {
  const state = mustApply(createGame({ decks: makeDecks(), seed: 1 }), {
    kind: "endTurn",
  });
  state.players.player2.hand = [];
  return state;
}

describe("DESTROY_TARGET_WARRIOR via real Attack cards", () => {
  it("Megawatt Apocalypse destroys an explicit non-defender target; combat still resolves", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Sonic" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const weapon = makeWeaponCard();
    const bystander = putWarriorOnField(game, "player1", {
      attachedWeapon: weapon,
    });
    const card = realCard("megawatt-apocalypse");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: bystander.instanceId,
    });

    // Bystander destroyed by the effect, its Weapon along with it.
    expect(state.players.player1.field).toHaveLength(1);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      bystander.card.id,
      weapon.id,
    ]);
    // Combat damage still hit the defender.
    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === card.id),
    ).toBe(true);
  });

  it("Guatavita defaults to destroying the defender; combat damage is skipped safely", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const card = realCard("guatavita");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player1.field).toHaveLength(0);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      defender.card.id,
    ]);
    expect(state.events.some((e) => e.type === "warriorAttacked")).toBe(false);
    expect(state.players.player2.field[0]?.attacksRemaining).toBe(0);
    expect(state.players.player2.spirit).toBe(1); // cost 1 paid
  });

  it("Dante's Lamentation aimed at a friendly Warrior fails safely; the attack proceeds", () => {
    const game = turnTwo();
    const attacker = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
      currentAttack: 500,
    });
    const friendly = putWarriorOnField(game, "player2");
    const defender = putWarriorOnField(game, "player1", { currentHealth: 9000 });
    const card = realCard("dantes-lamentation");
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: friendly.instanceId, // wrong side
    });

    // Effect rejected: friendly Warrior untouched, card spent + marked.
    expect(state.players.player2.field).toHaveLength(2);
    expect(state.players.player2.spirit).toBe(1);
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
    // Combat still resolved normally.
    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
  });

  it("fails cleanly with no target at all and with an invalid target", () => {
    const game = turnTwo();
    const card = realCard("megawatt-apocalypse");

    const noTarget = defaultEffectRegistry.resolve(game, card, {
      player: "player2", // no defender, no targetInstanceId
    });
    expect(noTarget.outcome.resolved).toBe(false);
    if (!noTarget.outcome.resolved) {
      expect(noTarget.outcome.code).toBe("EFFECT_FAILED");
      expect(noTarget.outcome.reason).toContain("target Warrior is required");
    }
    expect(noTarget.state).toBe(game);

    const ghost = defaultEffectRegistry.resolve(game, card, {
      player: "player2",
      targetInstanceId: "ghost",
    });
    expect(ghost.outcome.resolved).toBe(false);
    expect(ghost.state).toBe(game);
  });
});

describe("HEAL_TARGET via Gunder Love (real Item)", () => {
  it("heals the chosen Warrior by 1500", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player1.hand = [];
    const warrior = putWarriorOnField(game, "player1", { currentHealth: 900 });
    const item = realCard("gunder-love");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: warrior.instanceId,
    });

    expect(state.players.player1.field[0]?.currentHealth).toBe(2400);
    expect(state.players.player1.spirit).toBe(1);
    expect(
      state.events.some((e) => e.type === "effectResolved" && e.cardId === item.id),
    ).toBe(true);
  });

  it('may target any Warrior — its text says "Choose 1 Warrior", so enemies are legal', () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player1.hand = [];
    const enemy = putWarriorOnField(game, "player2", { currentHealth: 900 });
    const item = realCard("gunder-love");
    game.players.player1.hand.push(item);

    const state = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: enemy.instanceId,
    });

    expect(state.players.player2.field[0]?.currentHealth).toBe(2400);
  });

  it("fails safely when the target is missing or invalid", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    game.players.player1.hand = [];
    putWarriorOnField(game, "player1", { currentHealth: 900 });
    const item = realCard("gunder-love");
    game.players.player1.hand.push(item);

    const state = mustApply(game, { kind: "playItem", cardId: item.id }); // no target

    expect(state.players.player1.field[0]?.currentHealth).toBe(900); // untouched
    expect(state.players.player1.spirit).toBe(1); // spent per current behavior
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([item.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });
});

describe("DAMAGE_TARGET side enforcement (no real card carries it yet)", () => {
  it("rejects a friendly target and leaves the state untouched", () => {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const mine = putWarriorOnField(game, "player1");
    const card = makeAttackCard("Dwarf", {
      effectCode: "DAMAGE_TARGET",
      effectParams: { amount: 1000 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
      targetInstanceId: mine.instanceId,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
      expect(outcome.reason).toContain("enemy");
    }
    expect(state).toBe(game);
    expect(state.players.player1.field[0]?.currentHealth).toBe(mine.currentHealth);
  });
});
