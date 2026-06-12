/**
 * Group 2B-1: Out Deck target plumbing + REVIVE_WARRIOR, tested with the
 * real cards Totem's Creation and Bit Schneider from cards.json.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
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
    expect(revived.attacksRemaining).toBe(1);
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

describe("HEALTH_PER_ITEM_IN_OUT_DECK via Vibrant Pastures", () => {
  function play(game: GameState, targetInstanceId?: string): GameState {
    const item = realCard("vibrant-pastures");
    game.players.player1.hand.push(item);
    return mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId,
    });
  }

  it("heals nothing with no Items in the Out Deck (does not count itself)", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1", { currentHealth: 900 });

    const state = play(game, warrior.instanceId);

    expect(state.players.player1.field[0]?.currentHealth).toBe(900);
    expect(
      state.events.some(
        (e) =>
          e.type === "effectResolved" && e.effectCode === "HEALTH_PER_ITEM_IN_OUT_DECK",
      ),
    ).toBe(true);
  });

  it("heals 500 with one Item in the Out Deck", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1", { currentHealth: 900 });
    game.players.player1.outDeck.push(realCard("gunder-love"));

    const state = play(game, warrior.instanceId);
    expect(state.players.player1.field[0]?.currentHealth).toBe(1400);
  });

  it("heals 500 per Item with multiple Items, overhealing past max", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // 2000/2000
    game.players.player1.outDeck.push(
      realCard("gunder-love"),
      realCard("slush-fund"),
      realCard("cryraven-circus"),
    );

    const state = play(game, warrior.instanceId);
    expect(state.players.player1.field[0]?.currentHealth).toBe(3500);
    expect(state.players.player1.field[0]?.maxHealth).toBe(3500);
  });

  it("counts only Items: Warriors and Weapons in the Out Deck are ignored", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1", { currentHealth: 900 });
    game.players.player1.outDeck.push(
      realCard("bit-schneider"), // Warrior
      realCard("fafnir"), // Weapon
      realCard("gunder-love"), // the only Item
    );

    const state = play(game, warrior.instanceId);
    expect(state.players.player1.field[0]?.currentHealth).toBe(1400); // +500
  });

  it("fails safely with a missing target", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1", { currentHealth: 900 });
    game.players.player1.outDeck.push(realCard("gunder-love"));

    const state = play(game); // no targetInstanceId

    expect(state.players.player1.field[0]?.currentHealth).toBe(900);
    expect(state.players.player1.spirit).toBe(1); // spent per current behavior
    expect(
      state.events.some((e) => e.type === "effectNotImplemented"),
    ).toBe(true);
  });

  it("fails safely with an invalid target and does not corrupt state", () => {
    const game = newGame();
    game.players.player1.outDeck.push(realCard("gunder-love"));
    const item = realCard("vibrant-pastures");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetInstanceId: "ghost",
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
    }
    expect(state).toBe(game);
  });
});

describe("EXTRA_ATTACK_THIS_TURN via Choir of Pyrois", () => {
  /** Turn 2, P2 active: friendly Monk attacker vs a tough P1 defender. */
  function monkBattle() {
    const state = mustApply(createGame({ decks: makeDecks(), seed: 1 }), {
      kind: "endTurn",
    });
    state.players.player2.hand = [];
    const monk = putWarriorOnField(state, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(state, "player1", {
      currentHealth: 9000,
    });
    return { state, monk, defender };
  }

  function attackOnce(state: GameState, monk: { instanceId: string }, defender: { instanceId: string }) {
    return applyAction(state, {
      kind: "attack",
      attackerInstanceId: monk.instanceId,
      defenderInstanceId: defender.instanceId,
    });
  }

  it("a Warrior normally attacks only once per turn", () => {
    const { state, monk, defender } = monkBattle();
    let s = mustApply(state, { kind: "enterBattle" });
    const first = attackOnce(s, monk, defender);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = attackOnce(first.state, monk, defender);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("WARRIOR_EXHAUSTED");
  });

  it("grants a second Warrior-vs-Warrior attack this turn, but not a third", () => {
    const { state, monk, defender } = monkBattle();
    const item = realCard("choir-of-pyrois");
    state.players.player2.hand.push(item);

    let s = mustApply(state, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: monk.instanceId,
    });
    expect(s.players.player2.field[0]?.attacksRemaining).toBe(2);
    expect(
      s.events.some(
        (e) => e.type === "extraAttackGranted" && e.instanceId === monk.instanceId,
      ),
    ).toBe(true);

    s = mustApply(s, { kind: "enterBattle" });
    s = mustApply(s, {
      kind: "attack",
      attackerInstanceId: monk.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    s = mustApply(s, {
      kind: "attack",
      attackerInstanceId: monk.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(s.players.player1.field[0]?.currentHealth).toBe(8000); // 2 x 500

    const third = attackOnce(s, monk, defender);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("WARRIOR_EXHAUSTED");
  });

  it("an unused extra attack expires at end of turn", () => {
    const { state, monk } = monkBattle();
    const item = realCard("choir-of-pyrois");
    state.players.player2.hand.push(item);

    let s = mustApply(state, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: monk.instanceId,
    });
    expect(s.players.player2.field[0]?.attacksRemaining).toBe(2);

    s = mustApply(s, { kind: "endTurn" }); // turn 3, P1
    expect(s.players.player2.field[0]?.attacksRemaining).toBe(1); // capped

    s = mustApply(s, { kind: "endTurn" }); // turn 4, back to P2
    expect(s.players.player2.field[0]?.attacksRemaining).toBe(1); // not 2
  });

  it("does not bypass the one-direct-attack-per-turn limit", () => {
    const game = mustApply(createGame({ decks: makeDecks(), seed: 1 }), {
      kind: "endTurn",
    });
    game.players.player2.hand = [];
    const monk = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("choir-of-pyrois");
    game.players.player2.hand.push(item);

    let s = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: monk.instanceId,
    });
    s = mustApply(s, { kind: "enterBattle" });
    s = mustApply(s, { kind: "directAttack", attackerInstanceId: monk.instanceId });
    expect(s.players.player2.field[0]?.attacksRemaining).toBe(1); // one left...

    const second = applyAction(s, {
      kind: "directAttack",
      attackerInstanceId: monk.instanceId,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("DIRECT_ATTACK_LIMIT");
  });

  it("rejects a non-Monk friendly target (faction from the target keyword)", () => {
    const game = newGame();
    const dwarf = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const item = realCard("choir-of-pyrois");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetInstanceId: dwarf.instanceId,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("Monk");
    }
    expect(state).toBe(game);
    expect(game.players.player1.field[0]?.attacksRemaining).toBe(1);
  });

  it("rejects an enemy Monk target (wrong side)", () => {
    const game = newGame();
    const enemyMonk = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("choir-of-pyrois");

    const { outcome, state } = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetInstanceId: enemyMonk.instanceId,
    });

    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.reason).toContain("friendly");
    }
    expect(state).toBe(game);
  });

  it("fails safely for missing and invalid targets", () => {
    const game = newGame();
    putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("choir-of-pyrois");

    const missing = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
    });
    expect(missing.outcome.resolved).toBe(false);
    expect(missing.state).toBe(game);

    const invalid = defaultEffectRegistry.resolve(game, item, {
      player: "player1",
      targetInstanceId: "ghost",
    });
    expect(invalid.outcome.resolved).toBe(false);
    expect(invalid.state).toBe(game);
    expect(game.players.player1.field[0]?.attacksRemaining).toBe(1);
  });
});
