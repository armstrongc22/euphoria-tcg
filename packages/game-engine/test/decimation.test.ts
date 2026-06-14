/**
 * DECIMATION (Decimation).
 *
 * A Shaman Finisher Attack card. With 5+ Warriors sharing the field, every
 * Warrior draws a stone; the 2 who draw white are destroyed — indiscriminate
 * across both sides. The stone draw replaces the declared combat hit, and it
 * draws from the game's deterministic rngState so the outcome is reproducible.
 * Below the 5-Warrior threshold the card resolves but nothing happens.
 */
import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../src/index";
import {
  makeDecks,
  makeWarriorCard,
  mustApply,
  putWarriorOnField,
  realCard,
} from "./helpers";

function newGame(seed = 1): GameState {
  return createGame({ decks: makeDecks(), seed });
}

function toPlayer1Turn3(game: GameState): GameState {
  let next = mustApply(game, { kind: "endTurn" }); // player2, turn 2
  next = mustApply(next, { kind: "endTurn" }); // player1, turn 3
  return next;
}

function onFieldAnywhere(game: GameState, instanceId: string): boolean {
  return (["player1", "player2"] as const).some((p) =>
    game.players[p].field.some((w) => w.instanceId === instanceId),
  );
}

function whiteStones(game: GameState): string[] {
  return game.events
    .filter((e) => e.type === "warriorDrewStone" && e.stone === "white")
    .map((e) => (e as { instanceId: string }).instanceId);
}

/**
 * Player 1, turn 3: a Shaman attacker plus enough other Warriors to reach
 * `friendly` + `enemy` total, then Decimation is played against enemy slot 0.
 */
function decimationPlay(friendlyExtra: number, enemy: number) {
  let game = toPlayer1Turn3(newGame());
  const attacker = putWarriorOnField(game, "player1", {
    card: makeWarriorCard({ faction: "Shaman" }),
  });
  for (let i = 0; i < friendlyExtra; i++) {
    putWarriorOnField(game, "player1", { currentHealth: 9000, maxHealth: 9000 });
  }
  const enemies = Array.from({ length: enemy }, () =>
    putWarriorOnField(game, "player2", { currentHealth: 9000, maxHealth: 9000 }),
  );
  game.players.player1.spirit = 10;
  const card = realCard("decimation");
  game.players.player1.hand.push(card);
  game = mustApply(game, { kind: "enterBattle" });
  // The field order the handler draws against (player1's field, then
  // player2's), captured before resolution so reproducibility can be checked
  // by position — instanceIds use a global counter and differ between runs.
  const order = [
    ...game.players.player1.field,
    ...game.players.player2.field,
  ].map((w) => w.instanceId);
  game = mustApply(game, {
    kind: "attack",
    attackerInstanceId: attacker.instanceId,
    defenderInstanceId: enemies[0]!.instanceId,
    selectedAttackCardId: card.id,
  });
  return { game, attacker, enemies, card, order };
}

describe("DECIMATION (Decimation)", () => {
  it("resolves with no pending marker", () => {
    const { game, card } = decimationPlay(1, 3); // 5 Warriors total
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
  });

  it("destroys exactly the 2 Warriors that draw white when 5 are present", () => {
    const { game } = decimationPlay(1, 3); // 5 total
    const white = whiteStones(game);
    expect(white).toHaveLength(2);
    for (const id of white) expect(onFieldAnywhere(game, id)).toBe(false);

    const black = game.events
      .filter((e) => e.type === "warriorDrewStone" && e.stone === "black")
      .map((e) => (e as { instanceId: string }).instanceId);
    expect(black).toHaveLength(3);
    for (const id of black) expect(onFieldAnywhere(game, id)).toBe(true);
  });

  it("draws stones across both sides — friendly Warriors are eligible", () => {
    const { game } = decimationPlay(1, 3);
    const drawers = game.events.filter((e) => e.type === "warriorDrewStone");
    expect(drawers).toHaveLength(5);
    expect(drawers.some((e) => (e as { player: string }).player === "player1")).toBe(
      true,
    );
    expect(drawers.some((e) => (e as { player: string }).player === "player2")).toBe(
      true,
    );
  });

  it("does nothing below the 5-Warrior threshold but still resolves", () => {
    const { game, card } = decimationPlay(0, 3); // 1 attacker + 3 enemies = 4
    expect(game.events.some((e) => e.type === "warriorDrewStone")).toBe(false);
    expect(game.players.player1.field).toHaveLength(1);
    expect(game.players.player2.field).toHaveLength(3);
    // It resolved (was spent), so there is no pending marker.
    expect(
      game.events.some(
        (e) => e.type === "effectNotImplemented" && e.cardId === card.id,
      ),
    ).toBe(false);
  });

  it("replaces the combat hit — no Warrior takes the attacker's damage", () => {
    const { game } = decimationPlay(1, 3);
    expect(game.events.some((e) => e.type === "warriorAttacked")).toBe(false);
    // Every survivor keeps full HEALTH (only white-stone draws are removed).
    for (const p of ["player1", "player2"] as const) {
      for (const w of game.players[p].field) {
        if (w.maxHealth === 9000) expect(w.currentHealth).toBe(9000);
      }
    }
  });

  it("is reproducible: the same seed destroys the same field positions", () => {
    const positions = (r: ReturnType<typeof decimationPlay>) =>
      whiteStones(r.game)
        .map((id) => r.order.indexOf(id))
        .sort((x, y) => x - y);
    expect(positions(decimationPlay(1, 3))).toEqual(positions(decimationPlay(1, 3)));
  });
});
