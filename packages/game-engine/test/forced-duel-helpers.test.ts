/**
 * Helpers the manual-match UI uses to surface the two-target duel choice for
 * Trial of Gia (FORCED_DUEL): one friendly Warrior plus one enemy Warrior.
 * The engine's actual resolution is covered in the item/status effect tests.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  getForcedDuelEnemyTargets,
  getForcedDuelFriendlyTargets,
  isForcedDuelItem,
  type GameState,
} from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, putWarriorOnField } from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });
const duel = () => makeItemCard({ effectCode: "FORCED_DUEL" });

/** Lock two Warriors into a duel the way the FORCED_DUEL effect would. */
function lockDuel(state: GameState, friendlyId: string, enemyId: string): void {
  state.statuses.push({
    id: `status-${state.statuses.length + 1}`,
    code: "FORCED_DUEL",
    controller: "player1",
    affectedPlayer: "player2",
    affectedInstanceId: friendlyId,
    metadata: { opponentInstanceId: enemyId },
  });
}

describe("isForcedDuelItem", () => {
  it("is true for a FORCED_DUEL Item", () => {
    expect(isForcedDuelItem(duel())).toBe(true);
  });

  it("is false for a plain Item, a non-Item, or another targeted Item", () => {
    expect(isForcedDuelItem(makeItemCard())).toBe(false);
    expect(isForcedDuelItem(makeWarriorCard({ effectCode: "FORCED_DUEL" }))).toBe(false);
    expect(isForcedDuelItem(makeItemCard({ effectCode: "CONTROL_STEAL" }))).toBe(false);
  });
});

describe("getForcedDuelFriendlyTargets", () => {
  it("returns the active player's Warriors on the field", () => {
    const game = newGame();
    const a = putWarriorOnField(game, "player1");
    const b = putWarriorOnField(game, "player1");
    const ids = getForcedDuelFriendlyTargets(game, duel()).map((w) => w.instanceId);
    expect(ids.sort()).toEqual([a.instanceId, b.instanceId].sort());
  });

  it("reads the active player's field, not the opponent's", () => {
    const game = newGame();
    putWarriorOnField(game, "player2");
    expect(getForcedDuelFriendlyTargets(game, duel())).toHaveLength(0);
  });

  it("excludes a friendly Warrior already locked in a duel", () => {
    const game = newGame();
    const free = putWarriorOnField(game, "player1");
    const busy = putWarriorOnField(game, "player1");
    const enemy = putWarriorOnField(game, "player2");
    lockDuel(game, busy.instanceId, enemy.instanceId);
    const ids = getForcedDuelFriendlyTargets(game, duel()).map((w) => w.instanceId);
    expect(ids).toEqual([free.instanceId]);
  });

  it("is empty for a non-FORCED_DUEL Item even with friendly Warriors present", () => {
    const game = newGame();
    putWarriorOnField(game, "player1");
    expect(getForcedDuelFriendlyTargets(game, makeItemCard())).toHaveLength(0);
  });
});

describe("getForcedDuelEnemyTargets", () => {
  it("returns the opponent's Warriors on the field", () => {
    const game = newGame();
    const a = putWarriorOnField(game, "player2");
    const b = putWarriorOnField(game, "player2");
    const ids = getForcedDuelEnemyTargets(game, duel()).map((w) => w.instanceId);
    expect(ids.sort()).toEqual([a.instanceId, b.instanceId].sort());
  });

  it("reads the opponent's field, not the active player's own", () => {
    const game = newGame();
    putWarriorOnField(game, "player1");
    expect(getForcedDuelEnemyTargets(game, duel())).toHaveLength(0);
  });

  it("excludes an enemy Warrior already locked in a duel", () => {
    const game = newGame();
    const friendly = putWarriorOnField(game, "player1");
    const free = putWarriorOnField(game, "player2");
    const busy = putWarriorOnField(game, "player2");
    lockDuel(game, friendly.instanceId, busy.instanceId);
    const ids = getForcedDuelEnemyTargets(game, duel()).map((w) => w.instanceId);
    expect(ids).toEqual([free.instanceId]);
  });

  it("is empty for a non-FORCED_DUEL Item even with enemy Warriors present", () => {
    const game = newGame();
    putWarriorOnField(game, "player2");
    expect(getForcedDuelEnemyTargets(game, makeItemCard())).toHaveLength(0);
  });
});
