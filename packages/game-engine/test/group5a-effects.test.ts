/**
 * Group 5A: status/aura foundation — NO_ATTACKS_UNTIL_NEXT_TURN (Gorgon's
 * Eye) and PREVENT_ATTACKS_AGAINST_FACTION_NEXT_TURN (Orange Court), tested
 * with the real cards from cards.json.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
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

/** Ends turns until `player` is active (skipping past the no-attack turn 1). */
function advanceToTurnOf(state: GameState, player: "player1" | "player2"): GameState {
  let s = state;
  while (s.turn === 1 || s.activePlayer !== player) {
    s = mustApply(s, { kind: "endTurn" });
  }
  return s;
}

describe("NO_ATTACKS_UNTIL_NEXT_TURN (Gorgon's Eye)", () => {
  it("applies a PREVENT_ALL_ATTACKS status when played", () => {
    let game = advanceToTurnOf(newGame(), "player2");
    const item = realCard("gorgons-eye");
    game.players.player2.hand.push(item);

    game = mustApply(game, { kind: "playItem", cardId: item.id });

    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("PREVENT_ALL_ATTACKS");
    expect(status.controller).toBe("player2");
    expect(status.expiry).toEqual({
      player: "player2",
      timing: "startOfTurn",
      turnsRemaining: 1,
    });
    expect(
      game.events.some(
        (e) => e.type === "statusApplied" && e.code === "PREVENT_ALL_ATTACKS",
      ),
    ).toBe(true);
    expect(game.players.player2.outDeck.map((c) => c.id)).toContain(item.id);
  });

  it("blocks the controller's own attacks for the rest of the turn", () => {
    let game = advanceToTurnOf(newGame(), "player2");
    const attacker = putWarriorOnField(game, "player2");
    const defender = putWarriorOnField(game, "player1");
    const item = realCard("gorgons-eye");
    game.players.player2.hand.push(item);

    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "enterBattle" });

    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACKS_PREVENTED");
  });

  it("blocks direct attacks too", () => {
    let game = advanceToTurnOf(newGame(), "player2");
    const attacker = putWarriorOnField(game, "player2");
    const item = realCard("gorgons-eye");
    game.players.player2.hand.push(item);

    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "enterBattle" });

    const result = applyAction(game, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACKS_PREVENTED");
  });

  it("blocks the opponent on their following turn, then expires at the start of the controller's next turn", () => {
    let game = advanceToTurnOf(newGame(), "player2");
    putWarriorOnField(game, "player2");
    const p1Attacker = putWarriorOnField(game, "player1");
    const p2Attacker = putWarriorOnField(game, "player2");
    const item = realCard("gorgons-eye");
    game.players.player2.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });

    // Player 1's turn: still blocked ("until your next turn").
    game = mustApply(game, { kind: "endTurn" });
    expect(game.activePlayer).toBe("player1");
    game = mustApply(game, { kind: "enterBattle" });
    const blocked = applyAction(game, {
      kind: "attack",
      attackerInstanceId: p1Attacker.instanceId,
      defenderInstanceId: p2Attacker.instanceId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("ATTACKS_PREVENTED");

    // Player 2's next turn: the status expired in their Start Phase.
    game = mustApply(game, { kind: "endTurn" });
    expect(game.activePlayer).toBe("player2");
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) => e.type === "statusExpired" && e.code === "PREVENT_ALL_ATTACKS",
      ),
    ).toBe(true);
    game = mustApply(game, { kind: "enterBattle" });
    const allowed = applyAction(game, {
      kind: "attack",
      attackerInstanceId: p2Attacker.instanceId,
      defenderInstanceId: p1Attacker.instanceId,
    });
    expect(allowed.ok).toBe(true);
  });

  it("removes attack and direct-attack actions from getLegalActions while active", () => {
    let game = advanceToTurnOf(newGame(), "player2");
    putWarriorOnField(game, "player2");
    putWarriorOnField(game, "player1");
    const item = realCard("gorgons-eye");
    game.players.player2.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "enterBattle" });

    const kinds = getLegalActions(game).map((a) => a.kind);
    expect(kinds).not.toContain("attack");
    expect(kinds).not.toContain("directAttack");
    expect(kinds).toContain("endTurn");
  });
});

describe("PREVENT_ATTACKS_AGAINST_FACTION_NEXT_TURN (Orange Court)", () => {
  /** Player 1 active with a Dwarf and a Monk fielded, Orange Court played. */
  function setupOrangeCourt() {
    let game = advanceToTurnOf(newGame(), "player1");
    const dwarf = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const monk = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Monk" }),
    });
    const enemy = putWarriorOnField(game, "player2");
    const item = realCard("orange-court");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    return { game, dwarf, monk, enemy };
  }

  it("applies a faction-scoped status constraining the opponent", () => {
    const { game } = setupOrangeCourt();
    expect(game.statuses).toHaveLength(1);
    const status = game.statuses[0]!;
    expect(status.code).toBe("PREVENT_ATTACKS_AGAINST_FACTION");
    expect(status.controller).toBe("player1");
    expect(status.affectedPlayer).toBe("player2");
    expect(status.faction).toBe("Dwarf");
    expect(status.expiry).toEqual({
      player: "player2",
      timing: "endOfTurn",
      turnsRemaining: 1,
    });
  });

  it("blocks the opponent's attacks on protected-faction Warriors only", () => {
    let { game, dwarf, monk, enemy } = setupOrangeCourt();
    game = mustApply(game, { kind: "endTurn" });
    expect(game.activePlayer).toBe("player2");
    game = mustApply(game, { kind: "enterBattle" });

    const onDwarf = applyAction(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: dwarf.instanceId,
    });
    expect(onDwarf.ok).toBe(false);
    if (!onDwarf.ok) expect(onDwarf.error.code).toBe("ATTACK_TARGET_PROTECTED");

    const onMonk = applyAction(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: monk.instanceId,
    });
    expect(onMonk.ok).toBe(true);
  });

  it("excludes protected defenders from getLegalActions", () => {
    let { game, dwarf, monk } = setupOrangeCourt();
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });

    const defenders = getLegalActions(game)
      .filter((a) => a.kind === "attack")
      .map((a) => (a.kind === "attack" ? a.defenderInstanceId : ""));
    expect(defenders).not.toContain(dwarf.instanceId);
    expect(defenders).toContain(monk.instanceId);
  });

  it("does not restrict the controller's own attacks", () => {
    let game = advanceToTurnOf(newGame(), "player1");
    const myAttacker = putWarriorOnField(game, "player1");
    const enemyDwarf = putWarriorOnField(game, "player2", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const item = realCard("orange-court");
    game.players.player1.hand.push(item);
    game = mustApply(game, { kind: "playItem", cardId: item.id });
    game = mustApply(game, { kind: "enterBattle" });

    // The status protects the controller's Dwarves from the opponent; the
    // controller attacking the opponent's Dwarf is untouched by it.
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: myAttacker.instanceId,
      defenderInstanceId: enemyDwarf.instanceId,
    });
    expect(result.ok).toBe(true);
  });

  it("expires at the end of the opponent's next turn", () => {
    let { game, dwarf } = setupOrangeCourt();
    game = mustApply(game, { kind: "endTurn" }); // player2's turn (protected)
    game = mustApply(game, { kind: "endTurn" }); // player2's End Phase expires it

    expect(game.activePlayer).toBe("player1");
    expect(game.statuses).toHaveLength(0);
    expect(
      game.events.some(
        (e) =>
          e.type === "statusExpired" &&
          e.code === "PREVENT_ATTACKS_AGAINST_FACTION",
      ),
    ).toBe(true);

    // Player 2's following turn: the Dwarf is attackable again.
    game = mustApply(game, { kind: "endTurn" });
    expect(game.activePlayer).toBe("player2");
    const enemy = putWarriorOnField(game, "player2");
    game = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: enemy.instanceId,
      defenderInstanceId: dwarf.instanceId,
    });
    expect(result.ok).toBe(true);
  });

  it("fails safely (no status, card still spent) when the faction param is missing", () => {
    let game = advanceToTurnOf(newGame(), "player1");
    const broken = makeItemCard({
      effectCode: "PREVENT_ATTACKS_AGAINST_FACTION_NEXT_TURN",
    });
    game.players.player1.hand.push(broken);
    const spiritBefore = game.players.player1.spirit;

    game = mustApply(game, { kind: "playItem", cardId: broken.id });

    expect(game.statuses).toHaveLength(0);
    expect(game.players.player1.spirit).toBe(spiritBefore - broken.cost);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(broken.id);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === broken.id,
      ),
    ).toBe(true);
    expect(
      game.events.some((e) => e.type === "statusApplied"),
    ).toBe(false);
  });
});
