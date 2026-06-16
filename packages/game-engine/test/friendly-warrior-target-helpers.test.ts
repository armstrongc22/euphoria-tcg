/**
 * Helpers the manual-match UI uses to surface the friendly-Warrior target choice
 * for Items like GILs Unit (TEMPORARY_OUT_OF_PLAY_RESTORE): isFriendlyWarriorTargetItem
 * identifies the card, getFriendlyWarriorTargets lists the controller's Warriors.
 * The engine's actual resolution is covered in temporary-out-of-play-restore.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  getFriendlyWarriorTargets,
  isFriendlyWarriorTargetItem,
} from "../src/index";
import { makeDecks, makeItemCard, makeWarriorCard, putWarriorOnField } from "./helpers";

const newGame = () => createGame({ decks: makeDecks(), seed: 1 });
const gilsLike = () => makeItemCard({ effectCode: "TEMPORARY_OUT_OF_PLAY_RESTORE" });

describe("isFriendlyWarriorTargetItem", () => {
  it("is true for a TEMPORARY_OUT_OF_PLAY_RESTORE Item", () => {
    expect(isFriendlyWarriorTargetItem(gilsLike())).toBe(true);
  });

  it("is false for a plain Item, a non-Item, or a different effect", () => {
    expect(isFriendlyWarriorTargetItem(makeItemCard())).toBe(false);
    expect(
      isFriendlyWarriorTargetItem(makeWarriorCard({ effectCode: "TEMPORARY_OUT_OF_PLAY_RESTORE" })),
    ).toBe(false);
    expect(isFriendlyWarriorTargetItem(makeItemCard({ effectCode: "REVIVE_WARRIOR" }))).toBe(false);
  });
});

describe("getFriendlyWarriorTargets", () => {
  it("returns the active player's Warriors on the field", () => {
    const game = newGame();
    const a = putWarriorOnField(game, "player1");
    const b = putWarriorOnField(game, "player1");
    const ids = getFriendlyWarriorTargets(game, gilsLike()).map((w) => w.instanceId);
    expect(ids.sort()).toEqual([a.instanceId, b.instanceId].sort());
  });

  it("is empty when the player controls no Warrior", () => {
    const game = newGame();
    expect(getFriendlyWarriorTargets(game, gilsLike())).toHaveLength(0);
  });

  it("reads the active player's field, not the opponent's", () => {
    const game = newGame();
    putWarriorOnField(game, "player2");
    expect(getFriendlyWarriorTargets(game, gilsLike())).toHaveLength(0);
  });

  it("is empty for a card that does not target a friendly Warrior", () => {
    const game = newGame();
    putWarriorOnField(game, "player1");
    expect(getFriendlyWarriorTargets(game, makeItemCard())).toHaveLength(0);
  });
});
