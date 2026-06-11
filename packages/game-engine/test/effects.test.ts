import { describe, expect, it } from "vitest";
import {
  EffectRegistry,
  applyAction,
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
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

describe("effect registry: generic handlers", () => {
  it("resolves gainSpirit and leaves the input state untouched", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf", {
      effectCode: "GAIN_SPIRIT",
      effectParams: { amount: 2 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });

    expect(outcome.resolved).toBe(true);
    expect(state.players.player1.spirit).toBe(4); // 2 + 2
    expect(game.players.player1.spirit).toBe(2); // input untouched
    expect(
      state.events.some(
        (e) => e.type === "effectResolved" && e.effectCode === "GAIN_SPIRIT",
      ),
    ).toBe(true);
  });

  it("resolves camelCase effect codes identically", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf", {
      effectCode: "gainSpirit",
      effectParams: { amount: 1 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });
    expect(outcome.resolved).toBe(true);
    expect(state.players.player1.spirit).toBe(3);
  });

  it("resolves drawCards, safely hitting an empty deck", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf", {
      effectCode: "DRAW_CARDS",
      effectParams: { amount: 2 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });
    expect(outcome.resolved).toBe(true);
    expect(state.players.player1.hand).toHaveLength(8); // 6 + 2
    expect(state.players.player1.deck).toHaveLength(22);

    // Empty deck: still resolves, no crash, deck-out marker emitted.
    game.players.player1.deck = [];
    const empty = defaultEffectRegistry.resolve(game, card, { player: "player1" });
    expect(empty.outcome.resolved).toBe(true);
    expect(
      empty.state.events.some((e) => e.type === "drawFailedDeckEmpty"),
    ).toBe(true);
  });

  it("resolves modifyAttack permanently, or temporarily with a duration", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // attack 1000
    const permanent = makeAttackCard("Dwarf", {
      effectCode: "MODIFY_ATTACK",
      effectParams: { amount: 500 },
    });
    const temporary = makeAttackCard("Dwarf", {
      effectCode: "MODIFY_ATTACK",
      effectParams: { amount: 300, duration: "this_turn" },
    });
    const context = { player: "player1", targetInstanceId: warrior.instanceId } as const;

    const first = defaultEffectRegistry.resolve(game, permanent, context);
    expect(first.state.players.player1.field[0]?.currentAttack).toBe(1500);
    expect(first.state.players.player1.field[0]?.temporaryAttackBuffs).toEqual([]);

    const second = defaultEffectRegistry.resolve(first.state, temporary, context);
    expect(second.state.players.player1.field[0]?.currentAttack).toBe(1800);
    expect(second.state.players.player1.field[0]?.temporaryAttackBuffs).toEqual([
      { amount: 300 },
    ]);
  });

  it("resolves modifyHealth: heals can overheal, harm can destroy", () => {
    const game = newGame();
    const warrior = putWarriorOnField(game, "player1"); // health 2000/2000
    const context = { player: "player1", targetInstanceId: warrior.instanceId } as const;

    const heal = makeAttackCard("Dwarf", {
      effectCode: "MODIFY_HEALTH",
      effectParams: { amount: 1000 },
    });
    const healed = defaultEffectRegistry.resolve(game, heal, context);
    expect(healed.state.players.player1.field[0]?.currentHealth).toBe(3000);
    expect(healed.state.players.player1.field[0]?.maxHealth).toBe(3000);

    const harm = makeAttackCard("Dwarf", {
      effectCode: "MODIFY_HEALTH",
      effectParams: { amount: -5000 },
    });
    const harmed = defaultEffectRegistry.resolve(healed.state, harm, context);
    expect(harmed.outcome.resolved).toBe(true);
    expect(harmed.state.players.player1.field).toHaveLength(0);
    expect(harmed.state.players.player1.outDeck.map((c) => c.id)).toEqual([
      warrior.card.id,
    ]);
  });

  it("resolves dealDamageToWarrior; lethal damage takes the Weapon along", () => {
    const game = newGame();
    const weapon = makeWeaponCard();
    const warrior = putWarriorOnField(game, "player1", {
      currentHealth: 800,
      attachedWeapon: weapon,
    });
    const card = makeAttackCard("Dwarf", {
      effectCode: "DEAL_DAMAGE_TO_WARRIOR",
      effectParams: { amount: 1000 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player2",
      targetInstanceId: warrior.instanceId,
    });
    expect(outcome.resolved).toBe(true);
    expect(state.players.player1.field).toHaveLength(0);
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      warrior.card.id,
      weapon.id,
    ]);
  });
});

describe("effect registry: safety", () => {
  it("returns EFFECT_NOT_IMPLEMENTED for unknown codes without crashing", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf", {
      effectCode: "SUMMON_GYLIPPUS_MEGAFORM",
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });
    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_NOT_IMPLEMENTED");
    }
    expect(state).toBe(game); // untouched input returned as-is
  });

  it("returns EFFECT_NOT_IMPLEMENTED when a card has no effectCode", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf"); // no effectCode

    const { outcome } = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });
    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_NOT_IMPLEMENTED");
    }
  });

  it("a handler that mutates and then throws does not corrupt game state", () => {
    const registry = new EffectRegistry();
    registry.register("EXPLODE", (state) => {
      state.players.player1.spirit = 999;
      state.players.player1.hand = [];
      throw new Error("boom");
    });
    const game = newGame();
    const card = makeAttackCard("Dwarf", { effectCode: "EXPLODE" });

    const { outcome, state } = registry.resolve(game, card, { player: "player1" });
    expect(outcome.resolved).toBe(false);
    if (!outcome.resolved) {
      expect(outcome.code).toBe("EFFECT_FAILED");
      expect(outcome.reason).toContain("boom");
    }
    expect(state).toBe(game);
    expect(state.players.player1.spirit).toBe(2);
    expect(state.players.player1.hand).toHaveLength(6);
  });

  it("a handler that mutates and then reports failure is discarded", () => {
    const registry = new EffectRegistry();
    registry.register("FIZZLE", (state) => {
      state.players.player1.spirit = 999;
      return {
        resolved: false,
        code: "EFFECT_FAILED",
        reason: "no valid target",
      };
    });
    const game = newGame();
    const card = makeAttackCard("Dwarf", { effectCode: "FIZZLE" });

    const { state } = registry.resolve(game, card, { player: "player1" });
    expect(state.players.player1.spirit).toBe(2);
  });

  it("fails cleanly when a targeted effect has no target on the field", () => {
    const game = newGame();
    const card = makeAttackCard("Dwarf", {
      effectCode: "DEAL_DAMAGE_TO_WARRIOR",
      effectParams: { amount: 500 },
    });

    const { outcome, state } = defaultEffectRegistry.resolve(game, card, {
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

describe("attack cards resolve through the registry", () => {
  function dwarfBattle() {
    const game = createGame({ decks: makeDecks(), seed: 1 });
    const turn2 = mustApply(game, { kind: "endTurn" });
    turn2.players.player2.hand = [];
    const attacker = putWarriorOnField(turn2, "player2", {
      card: makeWarriorCard({ faction: "Dwarf" }),
      currentAttack: 500,
    });
    const defender = putWarriorOnField(turn2, "player1", { currentHealth: 9000 });
    return { game: turn2, attacker, defender };
  }

  it("spends Spirit and resolves a known effect (gainSpirit nets +1)", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf", {
      effectCode: "GAIN_SPIRIT",
      effectParams: { amount: 2 },
    });
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player2.spirit).toBe(3); // 2 - 1 cost + 2 effect
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectResolved" && e.cardId === card.id,
      ),
    ).toBe(true);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
    // Combat still resolved normally after the effect.
    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
  });

  it("modifyAttack buffs the attacker before combat damage lands", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf", {
      effectCode: "MODIFY_ATTACK",
      effectParams: { amount: 300, duration: "this_turn" },
    });
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    // 9000 - (500 base + 300 buff)
    expect(state.players.player1.field[0]?.currentHealth).toBe(8200);
    expect(
      state.players.player2.field[0]?.temporaryAttackBuffs,
    ).toEqual([{ amount: 300 }]);
  });

  it("an unknown effect keeps the Spirit spent and the attack resolving", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf", { effectCode: "MYSTERY_TECHNIQUE" });
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player2.spirit).toBe(1); // cost stays paid
    expect(state.players.player2.outDeck.map((c) => c.id)).toEqual([card.id]);
    expect(
      state.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
    expect(state.players.player1.field[0]?.currentHealth).toBe(8500);
  });

  it("an effect that destroys the defender skips combat damage safely", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf", {
      effectCode: "DEAL_DAMAGE_TO_WARRIOR",
      effectParams: { amount: 99999 }, // defaults to targeting the defender
    });
    game.players.player2.hand.push(card);

    let state = mustApply(game, { kind: "enterBattle" });
    state = mustApply(state, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    expect(state.players.player1.field).toHaveLength(0);
    // Destroyed exactly once, by the effect.
    expect(state.players.player1.outDeck.map((c) => c.id)).toEqual([
      defender.card.id,
    ]);
    expect(state.events.some((e) => e.type === "warriorAttacked")).toBe(false);
    expect(state.players.player2.field[0]?.exhausted).toBe(true);
  });

  it("a custom registry passed to applyAction is honored", () => {
    const { game, attacker, defender } = dwarfBattle();
    const card = makeAttackCard("Dwarf", { effectCode: "CUSTOM_TEST_EFFECT" });
    game.players.player2.hand.push(card);

    const registry = new EffectRegistry();
    registry.register("CUSTOM_TEST_EFFECT", (state, _params, context) => {
      state.players[context.player].lives += 1;
      return { resolved: true };
    });

    let state = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(
      state,
      {
        kind: "attack",
        attackerInstanceId: attacker.instanceId,
        defenderInstanceId: defender.instanceId,
        selectedAttackCardId: card.id,
      },
      registry,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players.player2.lives).toBe(4);
    }
  });
});
