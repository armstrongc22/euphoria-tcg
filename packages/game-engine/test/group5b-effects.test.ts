/**
 * Group 5B: remaining simple status/delayed effects — PROTECT_WARRIOR_THIS_TURN
 * (High Tea), NEXT_TURN_FACTION_BUFF (Heaven's Door Izakaya),
 * DELAYED_ATTACK_BUFF (Training Arc), and SPIRIT_ESCROW (Secure Deposits),
 * tested with the real cards from cards.json.
 */
import { describe, expect, it } from "vitest";
import { createGame, destroyWarrior, type GameState } from "../src/index";
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

/** Runs endTurn twice: back to the same player, one full round later. */
function fullRound(state: GameState): GameState {
  return mustApply(mustApply(state, { kind: "endTurn" }), { kind: "endTurn" });
}

describe("PROTECT_WARRIOR_THIS_TURN (High Tea)", () => {
  it("fails safely with fewer than 2 friendly Warriors (card spent, no status)", () => {
    let game = newGame();
    const lone = putWarriorOnField(game, "player1");
    const item = realCard("high-tea");
    game.players.player1.hand.push(item);

    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: lone.instanceId,
    });

    expect(game.statuses).toHaveLength(0);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(item.id);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("applies a Warrior-scoped PREVENT_DESTRUCTION status expiring this turn", () => {
    let game = newGame();
    const protectee = putWarriorOnField(game, "player1");
    putWarriorOnField(game, "player1");
    const item = realCard("high-tea");
    game.players.player1.hand.push(item);

    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: protectee.instanceId,
    });

    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("PREVENT_DESTRUCTION");
    expect(status.affectedInstanceId).toBe(protectee.instanceId);
    expect(status.metadata?.["penalty"]).toBe(1000);
    expect(status.expiry).toEqual({
      player: "player1",
      timing: "endOfTurn",
      turnsRemaining: 1,
    });
  });

  /** Player 1 with two Warriors, the first protected by High Tea. */
  function setupProtected() {
    let game = newGame();
    const protectee = putWarriorOnField(game, "player1");
    const bystander = putWarriorOnField(game, "player1");
    const item = realCard("high-tea");
    game.players.player1.hand.push(item);
    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: protectee.instanceId,
    });
    return { game, protectee, bystander };
  }

  it("converts a destruction into a 1000-health loss", () => {
    const { game, protectee } = setupProtected();
    destroyWarrior(game, "player1", protectee.instanceId);

    const survivor = game.players.player1.field.find(
      (w) => w.instanceId === protectee.instanceId,
    );
    expect(survivor).toBeDefined();
    expect(survivor!.currentHealth).toBe(1000); // 2000 default - 1000 penalty
    expect(
      game.events.some(
        (e) =>
          e.type === "destructionPrevented" &&
          e.instanceId === protectee.instanceId,
      ),
    ).toBe(true);
    expect(game.players.player1.outDeck).toHaveLength(1); // High Tea only
  });

  it("floors the penalty at 1 health — the Warrior cannot die this turn", () => {
    const { game, protectee } = setupProtected();
    const warrior = game.players.player1.field.find(
      (w) => w.instanceId === protectee.instanceId,
    )!;
    warrior.currentHealth = 500;

    destroyWarrior(game, "player1", protectee.instanceId);
    expect(warrior.currentHealth).toBe(1);

    // A second prevented destruction in the same turn still cannot kill it.
    destroyWarrior(game, "player1", protectee.instanceId);
    expect(warrior.currentHealth).toBe(1);
    expect(
      game.players.player1.field.some(
        (w) => w.instanceId === protectee.instanceId,
      ),
    ).toBe(true);
  });

  it("does not protect other Warriors", () => {
    const { game, bystander } = setupProtected();
    destroyWarrior(game, "player1", bystander.instanceId);
    expect(
      game.players.player1.field.some(
        (w) => w.instanceId === bystander.instanceId,
      ),
    ).toBe(false);
  });

  it("expires in the controller's End Phase", () => {
    let { game, protectee } = setupProtected();
    game = mustApply(game, { kind: "endTurn" });

    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) => e.type === "statusExpired" && e.code === "PREVENT_DESTRUCTION",
      ),
    ).toBe(true);

    destroyWarrior(game, "player1", protectee.instanceId);
    expect(
      game.players.player1.field.some(
        (w) => w.instanceId === protectee.instanceId,
      ),
    ).toBe(false);
  });
});

describe("NEXT_TURN_FACTION_BUFF (Heaven's Door Izakaya)", () => {
  /** Player 1 fields a Sonic and a Monk Warrior, then plays the Item. */
  function setupIzakaya() {
    let game = newGame();
    const sonic = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Sonic" }),
    });
    const monk = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("heavens-door-izakaya");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    return { game, sonic, monk };
  }

  it("stays dormant on the turn it is played", () => {
    const { game, sonic } = setupIzakaya();
    expect(game.statuses).toHaveLength(1);
    expect(game.statuses[0]!.code).toBe("DELAYED_FACTION_ATTACK_BUFF");
    const fielded = game.players.player1.field.find(
      (w) => w.instanceId === sonic.instanceId,
    )!;
    expect(fielded.currentAttack).toBe(1000); // unchanged
  });

  it("buffs only friendly faction Warriors at the start of the controller's next turn", () => {
    let { game, sonic, monk } = setupIzakaya();
    game = fullRound(game); // player1's next turn

    const field = game.players.player1.field;
    expect(field.find((w) => w.instanceId === sonic.instanceId)!.currentAttack).toBe(2000);
    expect(field.find((w) => w.instanceId === monk.instanceId)!.currentAttack).toBe(1000);
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorAttackModified" &&
          e.instanceId === sonic.instanceId &&
          e.amount === 1000,
      ),
    ).toBe(true);
  });

  it("the buff expires at the start of the controller's following turn", () => {
    let { game, sonic } = setupIzakaya();
    game = fullRound(game); // buff active
    game = fullRound(game); // buff expired

    const fielded = game.players.player1.field.find(
      (w) => w.instanceId === sonic.instanceId,
    )!;
    expect(fielded.currentAttack).toBe(1000);
    expect(fielded.temporaryAttackBuffs).toHaveLength(0);
  });

  it("fires harmlessly with no matching Warriors on the field", () => {
    let game = newGame();
    const item = realCard("heavens-door-izakaya");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = fullRound(game);
    expect(game.statuses).toHaveLength(0);
  });
});

describe("DELAYED_ATTACK_BUFF (Training Arc)", () => {
  it("fails safely without a target (card spent, no status)", () => {
    let game = newGame();
    const item = realCard("training-arc");
    game.players.player1.hand.push(item);

    game = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  function setupTrainingArc() {
    let game = newGame();
    const trainee = putWarriorOnField(game, "player1");
    const item = realCard("training-arc");
    game.players.player1.hand.push(item);
    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: trainee.instanceId,
    });
    return { game, trainee };
  }

  it("records a pending status on the chosen Warrior", () => {
    const { game, trainee } = setupTrainingArc();
    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("DELAYED_ATTACK_BUFF");
    expect(status.affectedInstanceId).toBe(trainee.instanceId);
    expect(status.metadata).toEqual({ amount: 1500, durationTurns: 2 });
  });

  it("applies +1500 at the controller's next turn and keeps it for 2 of the owner's turns", () => {
    let { game, trainee } = setupTrainingArc();
    const fielded = () =>
      game.players.player1.field.find((w) => w.instanceId === trainee.instanceId)!;

    game = fullRound(game); // owner turn 1 of the buff
    expect(fielded().currentAttack).toBe(2500);
    expect(fielded().temporaryAttackBuffs).toEqual([
      { amount: 1500, turnsRemaining: 2 },
    ]);

    game = fullRound(game); // owner turn 2 of the buff
    expect(fielded().currentAttack).toBe(2500);
    expect(fielded().temporaryAttackBuffs).toEqual([
      { amount: 1500, turnsRemaining: 1 },
    ]);

    game = fullRound(game); // expired
    expect(fielded().currentAttack).toBe(1000);
    expect(fielded().temporaryAttackBuffs).toHaveLength(0);
  });

  it("fizzles safely if the Warrior is destroyed while pending", () => {
    let { game, trainee } = setupTrainingArc();
    destroyWarrior(game, "player1", trainee.instanceId);

    game = fullRound(game);
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) => e.type === "warriorAttackModified" && e.amount === 1500,
      ),
    ).toBe(false);
  });
});

describe("SPIRIT_ESCROW (Secure Deposits)", () => {
  it("pays 1 Spirit into escrow and schedules a delayed gain of 3 in 3 turns", () => {
    let game = newGame();
    const item = realCard("secure-deposits");
    game.players.player1.hand.push(item);
    expect(game.players.player1.spirit).toBe(2); // 1 starting + 1 turn gain

    game = mustApply(game, { kind: "playItem", cardId: item.id });

    const p1 = game.players.player1;
    expect(p1.spirit).toBe(0); // 2 - 1 card cost - 1 escrow
    expect(p1.delayedEffects).toEqual([
      { type: "gainSpirit", amount: 3, turnsRemaining: 3 },
    ]);
    expect(
      game.events.some((e) => e.type === "spiritChanged" && e.amount === -1),
    ).toBe(true);
  });

  it("fails safely when no Spirit is left to escrow after paying the cost", () => {
    let game = newGame();
    game.players.player1.spirit = 1; // covers the card cost only
    const item = realCard("secure-deposits");
    game.players.player1.hand.push(item);

    game = mustApply(game, { kind: "playItem", cardId: item.id });

    const p1 = game.players.player1;
    expect(p1.spirit).toBe(0); // cost paid; escrow refused
    expect(p1.delayedEffects).toHaveLength(0);
    expect(p1.outDeck.map((c) => c.id)).toContain(item.id);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toBe(true);
  });

  it("pays out 3 Spirit at the start of the controller's third turn after playing", () => {
    let game = newGame();
    const item = realCard("secure-deposits");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id }); // spirit 0

    game = fullRound(game); // turn 3: countdown 2, spirit 0+1=1
    expect(game.players.player1.delayedEffects[0]!.turnsRemaining).toBe(2);
    game = fullRound(game); // turn 5: countdown 1, spirit 2
    expect(game.players.player1.spirit).toBe(2);
    game = fullRound(game); // turn 7: escrow pays 3, then +1 turn gain

    expect(game.players.player1.delayedEffects).toHaveLength(0);
    expect(game.players.player1.spirit).toBe(6); // 2 + 3 escrow + 1 gain
    expect(
      game.events.some((e) => e.type === "spiritGained" && e.amount === 3),
    ).toBe(true);
  });
});
