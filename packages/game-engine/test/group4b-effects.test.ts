/**
 * Group 4B: Attack-card combat modifiers with disable riders —
 * ATTACK_DAMAGE_BONUS_DISABLE (Pīsubaipā) and DAMAGE_UP_TO_TWO_DISABLE
 * (Serf's Bondage), tested with the real cards from cards.json.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  defaultEffectRegistry,
  getLegalActions,
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

/**
 * Player 1 in Battle Phase of turn 3 with a faction attacker, the Attack
 * card in hand, and two player-2 Warriors: a 5000-health defender and a
 * default (2000-health) bystander.
 */
function battleReady(faction: "Sonic" | "Surfer", slug: string) {
  let game = newGame();
  game = mustApply(game, { kind: "endTurn" });
  game = mustApply(game, { kind: "endTurn" }); // player1, turn 3
  const attacker = putWarriorOnField(game, "player1", {
    card: makeWarriorCard({ faction }),
  });
  const defender = putWarriorOnField(game, "player2", {
    currentHealth: 5000,
    maxHealth: 5000,
  });
  const other = putWarriorOnField(game, "player2");
  const card = realCard(slug);
  game.players.player1.hand.push(card);
  game = mustApply(game, { kind: "enterBattle" });
  return { game, attacker, defender, other, card };
}

describe("ATTACK_DAMAGE_BONUS_DISABLE (Pīsubaipā)", () => {
  it("adds 1000 to the current attack's damage and disables the defender for 2 turns", () => {
    let { game, attacker, defender, card } = battleReady("Sonic", "pisubaipa");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    const hitDefender = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hitDefender.currentHealth).toBe(3000); // 5000 - (1000 base + 1000 bonus)

    const buffed = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(buffed.currentAttack).toBe(2000);
    expect(buffed.temporaryAttackBuffs).toEqual([{ amount: 1000 }]);

    const disables = game.statuses.filter((s) => s.code === "DISABLE_WARRIOR_ATTACKS");
    expect(disables).toHaveLength(2);
    for (const status of disables) {
      expect(status.affectedInstanceId).toBe(defender.instanceId);
      expect(status.expiry.player).toBe("player2");
      expect(status.expiry.timing).toBe("startOfTurn");
    }
    expect(disables.map((s) => s.expiry.turnsRemaining).sort()).toEqual([1, 2]);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(card.id);
  });

  it("the damage bonus expires at the start of the controller's next turn", () => {
    let { game, attacker, defender, card } = battleReady("Sonic", "pisubaipa");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });
    game = mustApply(game, { kind: "endTurn" }); // player2, turn 4
    game = mustApply(game, { kind: "endTurn" }); // player1, turn 5

    const fielded = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(fielded.currentAttack).toBe(1000);
    expect(fielded.temporaryAttackBuffs).toHaveLength(0);
  });

  it("the defender cannot attack for 2 of its turns; bystanders are unaffected", () => {
    let { game, attacker, defender, other, card } = battleReady("Sonic", "pisubaipa");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    // Player 2's turn 4: first disable fired.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    const turn4 = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(turn4.ok).toBe(false);
    if (!turn4.ok) expect(turn4.error.code).toBe("WARRIOR_EXHAUSTED");

    const turn4Attackers = getLegalActions(game)
      .filter((a) => a.kind === "attack")
      .map((a) => (a.kind === "attack" ? a.attackerInstanceId : ""));
    expect(turn4Attackers).not.toContain(defender.instanceId);
    expect(turn4Attackers).toContain(other.instanceId);

    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: other.instanceId,
      defenderInstanceId: attacker.instanceId,
    });

    // Player 2's turn 6: second disable fired.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    const turn6 = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(turn6.ok).toBe(false);
    if (!turn6.ok) expect(turn6.error.code).toBe("WARRIOR_EXHAUSTED");

    // Player 2's turn 8: free again.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" });
    expect(game.statuses).toHaveLength(0);
    game = mustApply(game, { kind: "enterBattle" });
    const turn8 = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(turn8.ok).toBe(true);
  });

  it("fails safely outside an attack (no attacker/defender context)", () => {
    const game = newGame();
    const card = realCard("pisubaipa");
    const resolution = defaultEffectRegistry.resolve(game, card, {
      player: "player1",
    });
    expect(resolution.outcome.resolved).toBe(false);
    expect(resolution.state).toBe(game); // untouched input state returned
  });

  it("the attack-card window still demands a choice and honors skipping", () => {
    let { game, attacker, defender } = battleReady("Sonic", "pisubaipa");
    const noChoice = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(noChoice.ok).toBe(false);
    if (!noChoice.ok) expect(noChoice.error.code).toBe("ATTACK_CARD_CHOICE_REQUIRED");

    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      skipAttackCard: true,
    });
    const hitDefender = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hitDefender.currentHealth).toBe(4000); // base damage only
    expect(game.statuses).toHaveLength(0);
  });
});

describe("DAMAGE_UP_TO_TWO_DISABLE (Serf's Bondage)", () => {
  it("defaults to the defender: 1000 effect damage plus combat damage, then a 1-turn disable", () => {
    let { game, attacker, defender, card } = battleReady("Surfer", "serfs-bondage");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });

    const hitDefender = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hitDefender.currentHealth).toBe(3000); // 5000 - 1000 effect - 1000 combat

    const disables = game.statuses.filter((s) => s.code === "DISABLE_WARRIOR_ATTACKS");
    expect(disables).toHaveLength(1);
    expect(disables[0]!.affectedInstanceId).toBe(defender.instanceId);
    expect(disables[0]!.expiry).toEqual({
      player: "player2",
      timing: "startOfTurn",
      turnsRemaining: 1,
    });
  });

  it("an explicit target takes the effect damage and disable; the defender is not disabled", () => {
    let { game, attacker, defender, other, card } = battleReady("Surfer", "serfs-bondage");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: other.instanceId,
    });

    const field = game.players.player2.field;
    expect(field.find((w) => w.instanceId === other.instanceId)!.currentHealth).toBe(1000); // 2000 - 1000 effect
    expect(field.find((w) => w.instanceId === defender.instanceId)!.currentHealth).toBe(4000); // combat only

    const disables = game.statuses.filter((s) => s.code === "DISABLE_WARRIOR_ATTACKS");
    expect(disables).toHaveLength(1);
    expect(disables[0]!.affectedInstanceId).toBe(other.instanceId);

    // Player 2's next turn: the defender attacks freely, the target cannot.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    const blocked = applyAction(game, {
      kind: "attack",
      attackerInstanceId: other.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("WARRIOR_EXHAUSTED");
    const allowed = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(allowed.ok).toBe(true);
  });

  it("the disable covers exactly one of the target's turns", () => {
    let { game, attacker, defender, card } = battleReady("Surfer", "serfs-bondage");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
    });
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 4: disabled
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" }); // p2 turn 6: free
    expect(game.statuses).toHaveLength(0);

    game = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: defender.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(result.ok).toBe(true);
  });

  it("an invalid (friendly) target fails safely: card spent, no statuses, combat unaffected", () => {
    let { game, attacker, defender, card } = battleReady("Surfer", "serfs-bondage");
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: attacker.instanceId, // own Warrior: illegal
    });

    expect(game.statuses).toHaveLength(0);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(card.id);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(true);
    const hitDefender = game.players.player2.field.find(
      (w) => w.instanceId === defender.instanceId,
    )!;
    expect(hitDefender.currentHealth).toBe(4000); // combat damage still landed
  });

  it("a target destroyed by the effect damage gets no dangling disable", () => {
    let game = newGame();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "endTurn" });
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Surfer" }),
    });
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const frail = putWarriorOnField(game, "player2", { currentHealth: 800 });
    const card = realCard("serfs-bondage");
    game.players.player1.hand.push(card);
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      selectedAttackCardId: card.id,
      effectTargetInstanceId: frail.instanceId,
    });

    expect(
      game.players.player2.field.some((w) => w.instanceId === frail.instanceId),
    ).toBe(false);
    expect(game.players.player2.outDeck.some((c) => c.id === frail.card.id)).toBe(true);
    expect(game.statuses).toHaveLength(0);
  });
});
