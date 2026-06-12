/**
 * Group 4A: combat hooks on the status/aura system —
 * RESTRICT_OPPONENT_ATTACK_TARGET (Primetime Interview),
 * PUNISH_ATTACKERS_DISABLE (Moral Determination Authrotity), and
 * MONK_RETALIATION (A Dragon's Judgement), tested with the real cards.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  destroyWarrior,
  getLegalActions,
  type GameState,
} from "../src/index";
import {
  makeDecks,
  makeItemCard,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(): GameState {
  return createGame({ decks: makeDecks(), seed: 1 });
}

describe("RESTRICT_OPPONENT_ATTACK_TARGET (Primetime Interview)", () => {
  /** Player 1 designates one of player 2's two Warriors on turn 1. */
  function setupInterview() {
    let game = newGame();
    const designated = putWarriorOnField(game, "player2");
    const other = putWarriorOnField(game, "player2");
    const defender = putWarriorOnField(game, "player1");
    const item = realCard("primetime-interview");
    game.players.player1.hand.push(item);
    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: designated.instanceId,
    });
    return { game, designated, other, defender, item };
  }

  it("applies an opponent-scoped restriction status", () => {
    const { game, designated } = setupInterview();
    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("RESTRICT_ATTACKER_TO_WARRIOR");
    expect(status.controller).toBe("player1");
    expect(status.affectedPlayer).toBe("player2");
    expect(status.affectedInstanceId).toBe(designated.instanceId);
    expect(status.expiry).toEqual({
      player: "player1",
      timing: "startOfTurn",
      turnsRemaining: 1,
    });
  });

  it("fails safely on a missing or friendly target (card spent, no status)", () => {
    let game = newGame();
    const friendly = putWarriorOnField(game, "player1");
    putWarriorOnField(game, "player2");
    const item = realCard("primetime-interview");
    game.players.player1.hand.push(item, { ...item });

    game = mustApply(game, { kind: "playItem", cardId: item.id }); // no target
    expect(game.statuses).toHaveLength(0);

    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: friendly.instanceId, // wrong side
    });
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.filter(
        (e) => e.type === "effectNotImplemented" && e.cardId === item.id,
      ),
    ).toHaveLength(2);
  });

  it("only the designated Warrior may attack on the opponent's turn", () => {
    let { game, designated, other, defender } = setupInterview();
    game = mustApply(game, { kind: "endTurn" }); // player2's turn
    game = mustApply(game, { kind: "enterBattle" });

    const blocked = applyAction(game, {
      kind: "attack",
      attackerInstanceId: other.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("ATTACKER_RESTRICTED");

    const allowed = applyAction(game, {
      kind: "attack",
      attackerInstanceId: designated.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(allowed.ok).toBe(true);
  });

  it("restricts direct attacks too", () => {
    let game = newGame();
    const designated = putWarriorOnField(game, "player2");
    const other = putWarriorOnField(game, "player2");
    const item = realCard("primetime-interview");
    game.players.player1.hand.push(item);
    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: designated.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });

    const blocked = applyAction(game, {
      kind: "directAttack",
      attackerInstanceId: other.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("ATTACKER_RESTRICTED");

    const allowed = applyAction(game, {
      kind: "directAttack",
      attackerInstanceId: designated.instanceId,
    });
    expect(allowed.ok).toBe(true);
  });

  it("does not restrict the controller's own Warriors", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
    const mine = putWarriorOnField(game, "player1");
    const designated = putWarriorOnField(game, "player2");
    const item = realCard("primetime-interview");
    game.players.player1.hand.push(item);
    game = mustApply(game, {
      kind: "playItem",
      cardId: item.id,
      targetInstanceId: designated.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });

    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: mine.instanceId,
      defenderInstanceId: designated.instanceId,
    });
    expect(result.ok).toBe(true);
  });

  it("getLegalActions offers attacks only from the designated Warrior", () => {
    let { game, designated, other } = setupInterview();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });

    const attackers = getLegalActions(game)
      .filter((a) => a.kind === "attack" || a.kind === "directAttack")
      .map((a) => (a.kind === "attack" || a.kind === "directAttack" ? a.attackerInstanceId : ""));
    expect(attackers).toContain(designated.instanceId);
    expect(attackers).not.toContain(other.instanceId);
  });

  it("expires at the start of the controller's next turn", () => {
    let { game, other, defender } = setupInterview();
    game = mustApply(game, { kind: "endTurn" }); // player2 (restricted)
    game = mustApply(game, { kind: "endTurn" }); // player1: status expires at start
    expect(game.statuses).toHaveLength(0);

    game = mustApply(game, { kind: "endTurn" }); // player2's next turn
    game = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: other.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(result.ok).toBe(true);
  });
});

describe("PUNISH_ATTACKERS_DISABLE (Moral Determination Authrotity)", () => {
  /** Player 1 plays the Item turn 1; player 2 fields two attackers. */
  function setupAuthority() {
    let game = newGame();
    const attacker = putWarriorOnField(game, "player2");
    const idle = putWarriorOnField(game, "player2");
    const defender = putWarriorOnField(game, "player1");
    const item = realCard("moral-determination-authrotity");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    return { game, attacker, idle, defender };
  }

  it("applies a watch status covering the opponent's next turn", () => {
    const { game } = setupAuthority();
    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("PUNISH_ATTACKERS_WATCH");
    expect(status.affectedPlayer).toBe("player2");
    expect(status.expiry).toEqual({
      player: "player2",
      timing: "endOfTurn",
      turnsRemaining: 1,
    });
  });

  it("an attack during the watch earns the attacker a pending disable; idle Warriors are spared", () => {
    let { game, attacker, idle, defender } = setupAuthority();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });

    const disables = game.statuses.filter((s) => s.code === "DISABLE_WARRIOR_ATTACKS");
    expect(disables).toHaveLength(1);
    expect(disables[0]!.affectedInstanceId).toBe(attacker.instanceId);
    expect(disables[0]!.expiry).toEqual({
      player: "player2",
      timing: "startOfTurn",
      turnsRemaining: 1,
    });
    expect(
      game.statuses.some((s) => s.affectedInstanceId === idle.instanceId),
    ).toBe(false);
  });

  it("direct attacks during the watch are punished too", () => {
    let game = newGame();
    const attacker = putWarriorOnField(game, "player2");
    const item = realCard("moral-determination-authrotity");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });

    expect(
      game.statuses.some(
        (s) =>
          s.code === "DISABLE_WARRIOR_ATTACKS" &&
          s.affectedInstanceId === attacker.instanceId,
      ),
    ).toBe(true);
  });

  it("the punished Warrior cannot attack on its owner's next turn; others can", () => {
    let { game, attacker, idle, defender } = setupAuthority();
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 2
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // watch expires
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 4: disable fires

    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) =>
          e.type === "warriorAttacksDisabled" &&
          e.instanceId === attacker.instanceId,
      ),
    ).toBe(true);

    game = mustApply(game, { kind: "enterBattle" });
    const blocked = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("WARRIOR_EXHAUSTED");

    const attackerIds = getLegalActions(game)
      .filter((a) => a.kind === "attack")
      .map((a) => (a.kind === "attack" ? a.attackerInstanceId : ""));
    expect(attackerIds).not.toContain(attacker.instanceId);
    expect(attackerIds).toContain(idle.instanceId);

    const allowed = applyAction(game, {
      kind: "attack",
      attackerInstanceId: idle.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(allowed.ok).toBe(true);
  });

  it("the disable lasts one turn only", () => {
    let { game, attacker, defender } = setupAuthority();
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 2
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    game = mustApply(game, { kind: "endTurn" }); // p1 turn 3
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 4 (disabled)
    game = mustApply(game, { kind: "endTurn" }); // p1 turn 5
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 6

    game = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(result.ok).toBe(true);
  });

  it("fizzles safely if the punished Warrior is destroyed while pending", () => {
    let { game, attacker, defender } = setupAuthority();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    destroyWarrior(game, "player2", attacker.instanceId);

    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // disable fires on nothing
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some((e) => e.type === "warriorAttacksDisabled"),
    ).toBe(false);
  });
});

describe("MONK_RETALIATION (A Dragon's Judgement)", () => {
  /** Player 1 fields a Monk and a Dwarf and plays the Item on turn 1. */
  function setupJudgement() {
    let game = newGame();
    const monk = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const dwarf = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const enemy = putWarriorOnField(game, "player2");
    const item = realCard("a-dragons-judgement");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    return { game, monk, dwarf, enemy };
  }

  it("applies a Monk-faction retaliation status until the controller's next turn", () => {
    const { game } = setupJudgement();
    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("RETALIATE_AGAINST_FACTION_ATTACKERS");
    expect(status.faction).toBe("Monk");
    expect(status.metadata?.["amount"]).toBe(1000);
    expect(status.expiry).toEqual({
      player: "player1",
      timing: "startOfTurn",
      turnsRemaining: 1,
    });
  });

  it("an attacker that hits a Monk loses 1000 health after damage resolves", () => {
    let { game, monk, enemy } = setupJudgement();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: monk.instanceId,
    });

    const attacker = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    expect(attacker.currentHealth).toBe(1000); // 2000 - 1000 retaliation
    const defender = game.players.player1.field.find(
      (w) => w.instanceId === monk.instanceId,
    )!;
    expect(defender.currentHealth).toBe(1000); // combat damage unchanged
  });

  it("attacking a non-Monk Warrior triggers nothing", () => {
    let { game, dwarf, enemy } = setupJudgement();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: dwarf.instanceId,
    });

    const attacker = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    expect(attacker.currentHealth).toBe(2000);
  });

  it("retaliation can destroy the attacker", () => {
    let { game, monk, enemy } = setupJudgement();
    const fielded = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    fielded.currentHealth = 800;
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: monk.instanceId,
    });

    expect(
      game.players.player2.field.some((w) => w.instanceId === enemy.instanceId),
    ).toBe(false);
    expect(
      game.players.player2.outDeck.some((c) => c.id === enemy.card.id),
    ).toBe(true);
  });

  it("still retaliates when the attack destroys the Monk", () => {
    let { game, monk, enemy } = setupJudgement();
    const fielded = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    fielded.currentAttack = 3000; // lethal to the 2000-health Monk
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: monk.instanceId,
    });

    expect(
      game.players.player1.field.some((w) => w.instanceId === monk.instanceId),
    ).toBe(false);
    const attacker = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    expect(attacker.currentHealth).toBe(1000);
  });

  it("punishes the controller's own Warriors too — 'any Warrior that attacks a Monk'", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
    const mine = putWarriorOnField(game, "player1");
    const enemyMonk = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const item = realCard("a-dragons-judgement");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: mine.instanceId,
      defenderInstanceId: enemyMonk.instanceId,
    });

    const attacker = game.players.player1.field.find(
      (w) => w.instanceId === mine.instanceId,
    )!;
    expect(attacker.currentHealth).toBe(1000);
  });

  it("expires at the start of the controller's next turn", () => {
    let { game, monk, enemy } = setupJudgement();
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 2 (active, unused)
    game = mustApply(game, { kind: "endTurn" }); // p1 turn 3: expires
    expect(game.statuses).toHaveLength(0);

    game = mustApply(game, { kind: "endTurn" }); // p2 turn 4
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: monk.instanceId,
    });
    const attacker = game.players.player2.field.find(
      (w) => w.instanceId === enemy.instanceId,
    )!;
    expect(attacker.currentHealth).toBe(2000); // no retaliation
  });

  it("fails safely when the faction param is missing (card spent, no status)", () => {
    let game = newGame();
    const broken = makeItemCard({ effectCode: "MONK_RETALIATION" });
    game.players.player1.hand.push(broken);

    game = mustApply(game, { kind: "playItem", cardId: broken.id });

    expect(game.statuses).toHaveLength(0);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(broken.id);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === broken.id,
      ),
    ).toBe(true);
  });
});
