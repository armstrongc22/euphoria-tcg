/**
 * Group 4G: LINGERING_EXISTING_DAMAGE (Silurian Period).
 *
 * A Dwarf Attack card (timing on_attack_replace) that snapshots the
 * opponent's current Warriors and deals 500 to each, once now and again at
 * the start of each of the controller's next 3 turns (4 ticks total). It
 * replaces the normal combat hit, so the declared defender is never
 * double-counted. "Existing" here means Warriors that existed when the card
 * was played — not the target's existing damage — so every tick is a flat
 * 500 regardless of prior damage.
 */
import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  makeWeaponCard,
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

/** endTurn twice: from the active player's turn back to their next turn. */
function advanceToControllerNextTurn(game: GameState): GameState {
  let g = mustApply(game, { kind: "endTurn" });
  g = mustApply(g, { kind: "endTurn" });
  return g;
}

/**
 * Player 1, turn 3: a Dwarf attacker plays Silurian Period, declaring the
 * attack against enemy slot `defenderIndex`. `enemies` are the player2
 * Warriors (snapshot) created with the given overrides.
 */
function silurianPlay(
  enemies: Parameters<typeof putWarriorOnField>[2][],
  defenderIndex = 0,
) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    card: makeWarriorCard({ faction: "Dwarf" }),
  });
  const enemyWarriors = enemies.map((o) => putWarriorOnField(game, "player2", o));
  const silurian = realCard("silurian-period");
  game.players.player1.hand.push(silurian);
  game = mustApply(game, { kind: "enterBattle" });
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: enemyWarriors[defenderIndex]!.instanceId,
    selectedAttackCardId: silurian.id,
  });
  return { game, attacker, enemyWarriors, silurian };
}

function enemyHealth(game: GameState, instanceId: string): number | undefined {
  return game.players.player2.field.find((w) => w.instanceId === instanceId)
    ?.currentHealth;
}

describe("LINGERING_EXISTING_DAMAGE (Silurian Period)", () => {
  it("equip/play resolves without a pending marker", () => {
    const { game, silurian } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === silurian.id,
      ),
    ).toBe(false);
  });

  it("deals the first 500 tick immediately to a snapshot enemy at full health", () => {
    const { game, enemyWarriors } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    expect(enemyHealth(game, enemyWarriors[0]!.instanceId)).toBe(4500);
    expect(enemyHealth(game, enemyWarriors[1]!.instanceId)).toBe(4500);
  });

  it("deals a flat 500 to an already-damaged enemy (not scaled by existing damage)", () => {
    const { game, enemyWarriors } = silurianPlay([
      { currentHealth: 3000, maxHealth: 5000 }, // 2000 existing damage
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    expect(enemyHealth(game, enemyWarriors[0]!.instanceId)).toBe(2500); // 3000 - 500 flat
    expect(enemyHealth(game, enemyWarriors[1]!.instanceId)).toBe(4500);
  });

  it("repeats the 500 tick at the start of the controller's next 3 turns (4 total, then stops)", () => {
    let { game, enemyWarriors } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    const id = enemyWarriors[0]!.instanceId;
    expect(enemyHealth(game, id)).toBe(4500); // tick 1 (play turn)

    game = advanceToControllerNextTurn(game); // player1 turn 5
    expect(enemyHealth(game, id)).toBe(4000); // tick 2
    game = advanceToControllerNextTurn(game); // player1 turn 7
    expect(enemyHealth(game, id)).toBe(3500); // tick 3
    game = advanceToControllerNextTurn(game); // player1 turn 9
    expect(enemyHealth(game, id)).toBe(3000); // tick 4 (last)
    game = advanceToControllerNextTurn(game); // player1 turn 11
    expect(enemyHealth(game, id)).toBe(3000); // no further ticks
    expect(game.players.player1.delayedEffects).toHaveLength(0);
  });

  it("does not tick on the opponent's turns", () => {
    let { game, enemyWarriors } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    const id = enemyWarriors[0]!.instanceId;
    game = mustApply(game, { kind: "endTurn" }); // player2 turn 4
    expect(enemyHealth(game, id)).toBe(4500); // unchanged on the opponent's turn
  });

  it("only damages the snapshot: Warriors summoned later are never hit", () => {
    let { game, enemyWarriors } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    const original = enemyWarriors[0]!.instanceId;
    game = mustApply(game, { kind: "endTurn" }); // player2 turn 4
    const newcomer = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "endTurn" }); // player1 turn 5 — tick 2
    expect(enemyHealth(game, original)).toBe(4000);
    expect(enemyHealth(game, newcomer.instanceId)).toBe(5000); // untouched
  });

  it("skips a snapshot Warrior that has left the field (no crash)", () => {
    // First enemy dies on tick 1; the lingering effect skips it thereafter.
    let { game, enemyWarriors } = silurianPlay([
      { currentHealth: 500, maxHealth: 500 }, // dies to tick 1
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    expect(
      game.players.player2.field.some(
        (w) => w.instanceId === enemyWarriors[0]!.instanceId,
      ),
    ).toBe(false);
    game = advanceToControllerNextTurn(game); // player1 turn 5 — tick 2
    expect(enemyHealth(game, enemyWarriors[1]!.instanceId)).toBe(4000);
  });

  it("destroys a snapshot Warrior and moves it and its Weapon to the Out Deck", () => {
    const weapon = makeWeaponCard();
    const { game, enemyWarriors } = silurianPlay([
      { currentHealth: 500, maxHealth: 500, attachedWeapon: weapon },
    ]);
    expect(
      game.players.player2.field.some(
        (w) => w.instanceId === enemyWarriors[0]!.instanceId,
      ),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(enemyWarriors[0]!.card.id);
    expect(outDeckIds).toContain(weapon.id);
  });

  it("replaces the attack: the declared defender takes only the tick, no combat damage", () => {
    const { game, enemyWarriors } = silurianPlay([
      { currentHealth: 5000, maxHealth: 5000 },
    ]);
    // Only the 500 tick (not 500 + 1000 combat).
    expect(enemyHealth(game, enemyWarriors[0]!.instanceId)).toBe(4500);
    expect(game.events.some((e) => e.type === "warriorAttacked")).toBe(false);
  });

  it("does not damage the controller's own Warriors", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const friendly = putWarriorOnField(game, "player1", {
      currentHealth: 4000,
      maxHealth: 4000,
    });
    const enemy = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const silurian = realCard("silurian-period");
    game.players.player1.hand.push(silurian);
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: enemy.instanceId,
      selectedAttackCardId: silurian.id,
    });
    game = advanceToControllerNextTurn(game); // a couple of ticks later
    expect(
      game.players.player1.field.find((w) => w.instanceId === friendly.instanceId)!
        .currentHealth,
    ).toBe(4000); // never touched
  });

  it("an invalid attack fails safely: no damage dealt, nothing scheduled", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const enemy = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const silurian = realCard("silurian-period");
    game.players.player1.hand.push(silurian);
    game = mustApply(game, { kind: "enterBattle" });
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: "no-such-defender",
      selectedAttackCardId: silurian.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WARRIOR_NOT_FOUND");
    // Untouched original state.
    expect(enemyHealth(game, enemy.instanceId)).toBe(5000);
    expect(game.players.player1.delayedEffects).toHaveLength(0);
    expect(game.players.player1.hand.some((c) => c.id === silurian.id)).toBe(true);
  });
});
