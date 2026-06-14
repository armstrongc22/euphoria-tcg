/**
 * Group 4F: splash / adjacency combat targeting.
 *
 * - The shared field-geometry helper (splash.ts): fieldSlot,
 *   adjacentWarriors, adjacentWarriorList, otherWarriors.
 * - ATTACK_TARGET_SPLASH (Apex Forest): the chosen defender takes normal
 *   combat damage; every *other* enemy Warrior takes the splash (faithful
 *   to "All other Warriors on your opponent's side").
 * - WEAPON_ATTACK_BONUS_SPLASH (Scythe Cycle): +500 ATTACK at equip; on
 *   attack, if the opponent has more than 1 Warrior, a selected enemy takes
 *   500 splash damage.
 */
import { describe, expect, it } from "vitest";
import {
  adjacentWarriorList,
  adjacentWarriors,
  applyAction,
  createGame,
  fieldSlot,
  otherWarriors,
  type GameState,
} from "../src/index";
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

describe("field adjacency helper (splash.ts)", () => {
  /** A player2 field of `n` Warriors; returns their instance ids in slot order. */
  function fieldOf(n: number): { game: GameState; ids: string[] } {
    const game = newGame();
    const ids = Array.from(
      { length: n },
      () => putWarriorOnField(game, "player2").instanceId,
    );
    return { game, ids };
  }

  it("returns both neighbours for an interior slot", () => {
    const { game, ids } = fieldOf(3);
    const field = game.players.player2.field;
    const { left, right } = adjacentWarriors(field, ids[1]!);
    expect(left?.instanceId).toBe(ids[0]);
    expect(right?.instanceId).toBe(ids[2]);
    expect(fieldSlot(field, ids[1]!)).toBe(1);
  });

  it("omits the missing side at each edge", () => {
    const { game, ids } = fieldOf(3);
    const field = game.players.player2.field;
    expect(adjacentWarriors(field, ids[0]!).left).toBeUndefined();
    expect(adjacentWarriors(field, ids[0]!).right?.instanceId).toBe(ids[1]);
    expect(adjacentWarriors(field, ids[2]!).right).toBeUndefined();
    expect(adjacentWarriors(field, ids[2]!).left?.instanceId).toBe(ids[1]);
  });

  it("returns nothing for a lone Warrior or an absent id", () => {
    const { game, ids } = fieldOf(1);
    const field = game.players.player2.field;
    expect(adjacentWarriorList(field, ids[0]!)).toHaveLength(0);
    expect(adjacentWarriors(field, "no-such-warrior")).toEqual({});
    expect(fieldSlot(field, "no-such-warrior")).toBe(-1);
  });

  it("otherWarriors excludes the given Warrior and preserves slot order", () => {
    const { game, ids } = fieldOf(3);
    const others = otherWarriors(game.players.player2.field, ids[1]!).map(
      (w) => w.instanceId,
    );
    expect(others).toEqual([ids[0], ids[2]]);
  });

  it("adjacency is always a subset of otherWarriors (shared geometry)", () => {
    const { game, ids } = fieldOf(5);
    const field = game.players.player2.field;
    const adjacent = adjacentWarriorList(field, ids[2]!).map((w) => w.instanceId);
    const others = otherWarriors(field, ids[2]!).map((w) => w.instanceId);
    expect(adjacent).toEqual([ids[1], ids[3]]);
    expect(adjacent.every((id) => others.includes(id))).toBe(true);
  });
});

describe("ATTACK_TARGET_SPLASH (Apex Forest)", () => {
  /**
   * A Dwarf attacker on player 1's turn 3 with Apex Forest in hand, facing
   * a player2 field of the given healths (slot order). `defenderSlot`
   * names which enemy slot is the primary, attacked target.
   */
  function apexBattle(enemyHealths: number[]) {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1", {
      card: makeWarriorCard({ faction: "Dwarf" }),
    });
    const enemies = enemyHealths.map((h) =>
      putWarriorOnField(game, "player2", { currentHealth: h, maxHealth: h }),
    );
    const apex = realCard("apex-forest");
    game.players.player1.hand.push(apex);
    game = mustApply(game, { kind: "enterBattle" });
    return { game, attacker, enemies, apex };
  }

  function attackWith(
    game: GameState,
    attackerId: string,
    defenderId: string,
    apexId: string,
  ): GameState {
    return mustApply(game, {
      kind: "attack",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
      selectedAttackCardId: apexId,
    });
  }

  it("splashes the left adjacent Warrior", () => {
    let { game, attacker, enemies, apex } = apexBattle([3000, 3000]); // [left, defender]
    const [left, defender] = enemies;
    game = attackWith(game, attacker.instanceId, defender!.instanceId, apex.id);
    const hitLeft = game.players.player2.field.find(
      (w) => w.instanceId === left!.instanceId,
    )!;
    expect(hitLeft.currentHealth).toBe(2000); // 3000 - 1000 splash
  });

  it("splashes the right adjacent Warrior", () => {
    let { game, attacker, enemies, apex } = apexBattle([3000, 3000]); // [defender, right]
    const [defender, right] = enemies;
    game = attackWith(game, attacker.instanceId, defender!.instanceId, apex.id);
    const hitRight = game.players.player2.field.find(
      (w) => w.instanceId === right!.instanceId,
    )!;
    expect(hitRight.currentHealth).toBe(2000);
  });

  it("splashes both adjacent Warriors", () => {
    let { game, attacker, enemies, apex } = apexBattle([3000, 5000, 3000]); // [left, defender, right]
    const [left, defender, right] = enemies;
    game = attackWith(game, attacker.instanceId, defender!.instanceId, apex.id);
    const field = game.players.player2.field;
    expect(field.find((w) => w.instanceId === left!.instanceId)!.currentHealth).toBe(2000);
    expect(field.find((w) => w.instanceId === right!.instanceId)!.currentHealth).toBe(2000);
    // The primary defender took only combat damage, never splash.
    expect(field.find((w) => w.instanceId === defender!.instanceId)!.currentHealth).toBe(4000);
  });

  it("splashes all other enemies, including non-adjacent ones (faithful to card text)", () => {
    let { game, attacker, enemies, apex } = apexBattle([3000, 5000, 3000, 3000]);
    const defender = enemies[1]!; // interior; enemies[3] is non-adjacent
    game = attackWith(game, attacker.instanceId, defender.instanceId, apex.id);
    const nonAdjacent = game.players.player2.field.find(
      (w) => w.instanceId === enemies[3]!.instanceId,
    )!;
    expect(nonAdjacent.currentHealth).toBe(2000); // hit despite not being adjacent
  });

  it("does nothing when there are no other enemy Warriors", () => {
    let { game, attacker, enemies, apex } = apexBattle([3000]); // defender alone
    const defender = enemies[0]!;
    game = attackWith(game, attacker.instanceId, defender.instanceId, apex.id);
    // Only the defender exists and it took combat damage; no crash, no splash.
    expect(game.players.player2.field).toHaveLength(1);
    expect(game.players.player2.field[0]!.currentHealth).toBe(2000);
  });

  it("does not hit the attacker's own Warriors", () => {
    let { game, attacker, enemies, apex } = apexBattle([5000, 3000]);
    const bystander = putWarriorOnField(game, "player1", {
      currentHealth: 4000,
      maxHealth: 4000,
    });
    const defender = enemies[0]!;
    game = attackWith(game, attacker.instanceId, defender.instanceId, apex.id);
    const friendly = game.players.player1.field.find(
      (w) => w.instanceId === bystander.instanceId,
    )!;
    expect(friendly.currentHealth).toBe(4000); // untouched
  });

  it("destroys an adjacent Warrior and moves it and its Weapon to the Out Deck", () => {
    let { game, attacker, enemies, apex } = apexBattle([5000, 1000]); // [defender, fragile]
    const fragileWeapon = makeWeaponCard();
    const fragile = enemies[1]!;
    // Attach a Weapon to the fragile splash victim.
    game.players.player2.field.find(
      (w) => w.instanceId === fragile.instanceId,
    )!.attachedWeapon = fragileWeapon;
    const defender = enemies[0]!;
    game = attackWith(game, attacker.instanceId, defender.instanceId, apex.id);

    expect(
      game.players.player2.field.some((w) => w.instanceId === fragile.instanceId),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(fragile.card.id);
    expect(outDeckIds).toContain(fragileWeapon.id);
  });

  it("does not splash on an invalid attack", () => {
    const { game, attacker, enemies, apex } = apexBattle([3000, 3000]);
    const result = applyAction(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: "no-such-defender",
      selectedAttackCardId: apex.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WARRIOR_NOT_FOUND");
    // The untouched original state: every enemy still at full health.
    for (const enemy of enemies) {
      expect(
        game.players.player2.field.find((w) => w.instanceId === enemy.instanceId)!
          .currentHealth,
      ).toBe(3000);
    }
  });
});

describe("WEAPON_ATTACK_BONUS_SPLASH (Scythe Cycle)", () => {
  /**
   * Player 1, turn 3: an attacker equipped with Scythe Cycle (+500 ATTACK),
   * plus `enemyHealths` enemy Warriors. The first enemy is the primary
   * defender; the rest are potential splash targets.
   */
  function scytheBattle(enemyHealths: number[]) {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1");
    const enemies = enemyHealths.map((h) =>
      putWarriorOnField(game, "player2", { currentHealth: h, maxHealth: h }),
    );
    const scythe = realCard("scythe-cycle");
    game.players.player1.hand.push(scythe);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: scythe.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    return { game, attacker, enemies, scythe };
  }

  it("grants +500 ATTACK at equip with no pending marker", () => {
    const { game, attacker, scythe } = scytheBattle([5000]);
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === scythe.id,
      ),
    ).toBe(false);
    const equipped = game.players.player1.field.find(
      (w) => w.instanceId === attacker.instanceId,
    )!;
    expect(equipped.currentAttack).toBe(1500); // 1000 + 500
    expect(equipped.attachedWeapon?.id).toBe(scythe.id);
  });

  it("splashes the selected enemy 500 when the opponent has more than 1 Warrior", () => {
    let { game, attacker, enemies } = scytheBattle([5000, 5000]);
    const [defender, other] = enemies;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender!.instanceId,
      effectTargetInstanceId: other!.instanceId,
    });
    const field = game.players.player2.field;
    expect(field.find((w) => w.instanceId === defender!.instanceId)!.currentHealth).toBe(3500); // 5000 - 1500 combat
    expect(field.find((w) => w.instanceId === other!.instanceId)!.currentHealth).toBe(4500); // 5000 - 500 splash
  });

  it("does not splash when the opponent has exactly 1 Warrior", () => {
    let { game, attacker, enemies } = scytheBattle([5000]);
    const defender = enemies[0]!;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: defender.instanceId,
    });
    // Only combat damage; no extra 500 (no other Warrior to "select").
    expect(game.players.player2.field[0]!.currentHealth).toBe(3500);
  });

  it("missing, invalid, and friendly splash targets are ignored safely", () => {
    const base = scytheBattle([5000, 5000]);
    const defender = base.enemies[0]!;
    const friendly = base.attacker; // a friendly Warrior id
    for (const target of [undefined, "no-such-warrior", friendly.instanceId]) {
      const result = applyAction(base.game, {
        kind: "attack",
        attackerInstanceId: base.attacker.instanceId,
        defenderInstanceId: defender.instanceId,
        effectTargetInstanceId: target,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const other = result.state.players.player2.field.find(
        (w) => w.instanceId === base.enemies[1]!.instanceId,
      )!;
      expect(other.currentHealth).toBe(5000); // no splash reached anyone
      const me = result.state.players.player1.field.find(
        (w) => w.instanceId === friendly.instanceId,
      )!;
      expect(me.currentHealth).toBe(2000); // attacker never splashed
    }
  });

  it("can destroy the selected enemy and move it and its Weapon to the Out Deck", () => {
    let { game, attacker, enemies } = scytheBattle([5000, 500]);
    const [defender, fragile] = enemies;
    const fragileWeapon = makeWeaponCard();
    game.players.player2.field.find(
      (w) => w.instanceId === fragile!.instanceId,
    )!.attachedWeapon = fragileWeapon;
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender!.instanceId,
      effectTargetInstanceId: fragile!.instanceId,
    });
    expect(
      game.players.player2.field.some((w) => w.instanceId === fragile!.instanceId),
    ).toBe(false);
    const outDeckIds = game.players.player2.outDeck.map((c) => c.id);
    expect(outDeckIds).toContain(fragile!.card.id);
    expect(outDeckIds).toContain(fragileWeapon.id);
  });

  it("does not splash when the Weapon is unattached", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // no Scythe
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const other = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: other.instanceId,
    });
    expect(
      game.players.player2.field.find((w) => w.instanceId === other.instanceId)!
        .currentHealth,
    ).toBe(5000);
  });

  it("stops splashing once the equipped Warrior dies and the Weapon moves to the Out Deck", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // 2000 health
    const defender = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const other = putWarriorOnField(game, "player2", {
      currentHealth: 5000,
      maxHealth: 5000,
    });
    const killer = putWarriorOnField(game, "player2", { currentAttack: 5000 });
    const scythe = realCard("scythe-cycle");
    game.players.player1.hand.push(scythe);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: scythe.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: other.instanceId,
    });

    // Player 2, turn 4: the killer destroys the equipped Warrior.
    game = mustApply(game, { kind: "endTurn" });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: killer.instanceId,
      defenderInstanceId: attacker.instanceId,
    });
    expect(
      game.players.player1.field.some((w) => w.instanceId === attacker.instanceId),
    ).toBe(false);
    expect(game.players.player1.outDeck.map((c) => c.id)).toContain(scythe.id);

    // Player 1, turn 5: a fresh unequipped attacker attacks — no splash.
    game = mustApply(game, { kind: "endTurn" });
    const rookie = putWarriorOnField(game, "player1");
    const otherHealthBefore = game.players.player2.field.find(
      (w) => w.instanceId === other.instanceId,
    )!.currentHealth;
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "attack",
      attackerInstanceId: rookie.instanceId,
      defenderInstanceId: defender.instanceId,
      effectTargetInstanceId: other.instanceId,
    });
    const otherHealthAfter = game.players.player2.field.find(
      (w) => w.instanceId === other.instanceId,
    )!.currentHealth;
    expect(otherHealthAfter).toBe(otherHealthBefore); // no splash from the rookie
  });

  it("a direct attack does not trigger the splash", () => {
    let game = toPlayer1Turn3(newGame());
    const attacker = putWarriorOnField(game, "player1"); // opponent has no Warriors
    const scythe = realCard("scythe-cycle");
    game.players.player1.hand.push(scythe);
    game = mustApply(game, {
      kind: "equipWeapon",
      cardId: scythe.id,
      warriorInstanceId: attacker.instanceId,
    });
    game = mustApply(game, { kind: "enterBattle" });
    game = mustApply(game, {
      kind: "directAttack",
      attackerInstanceId: attacker.instanceId,
    });
    expect(game.players.player2.lives).toBe(2);
    expect(
      game.events.some((e) => e.type === "warriorHealthModified"),
    ).toBe(false);
    // The static +500 ATTACK is still present.
    expect(
      game.players.player1.field.find((w) => w.instanceId === attacker.instanceId)!
        .currentAttack,
    ).toBe(1500);
  });
});
