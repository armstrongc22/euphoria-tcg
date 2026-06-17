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

describe("getFriendlyWarriorTargets — Batch A effects", () => {
  it("identifies the Batch A friendly-target Item codes", () => {
    for (const code of [
      "EXTRA_ATTACK_THIS_TURN",
      "PROTECT_WARRIOR_THIS_TURN",
      "TANK_FORM",
      "HEAL_TARGET",
      "HEALTH_PER_ITEM_IN_OUT_DECK",
      "DELAYED_ATTACK_BUFF",
    ]) {
      expect(isFriendlyWarriorTargetItem(makeItemCard({ effectCode: code }))).toBe(true);
    }
  });

  it("HEAL_TARGET offers every friendly Warrior", () => {
    const game = newGame();
    putWarriorOnField(game, "player1");
    putWarriorOnField(game, "player1");
    const card = makeItemCard({ effectCode: "HEAL_TARGET", effectParams: { target: "one_warrior" } });
    expect(getFriendlyWarriorTargets(game, card)).toHaveLength(2);
  });

  it("EXTRA_ATTACK_THIS_TURN offers only Monk Warriors (faction from the keyword)", () => {
    const game = newGame();
    const monk = putWarriorOnField(game, "player1", { card: makeWarriorCard({ faction: "Monk" }) });
    putWarriorOnField(game, "player1", { card: makeWarriorCard({ faction: "Dwarf" }) });
    const card = makeItemCard({
      effectCode: "EXTRA_ATTACK_THIS_TURN",
      effectParams: { target: "friendly_monk_warrior" },
    });
    const ids = getFriendlyWarriorTargets(game, card).map((w) => w.instanceId);
    expect(ids).toEqual([monk.instanceId]);
  });

  it("PROTECT_WARRIOR_THIS_TURN needs 2+ Warriors", () => {
    const game = newGame();
    const card = makeItemCard({
      effectCode: "PROTECT_WARRIOR_THIS_TURN",
      effectParams: { target: "friendly_warrior" },
    });
    putWarriorOnField(game, "player1");
    expect(getFriendlyWarriorTargets(game, card)).toHaveLength(0); // only 1 Warrior
    putWarriorOnField(game, "player1");
    expect(getFriendlyWarriorTargets(game, card)).toHaveLength(2);
  });

  it("TANK_FORM excludes a Warrior already in the tank", () => {
    const game = newGame();
    const free = putWarriorOnField(game, "player1");
    const tanked = putWarriorOnField(game, "player1");
    (tanked as { tankForm?: unknown }).tankForm = { restoreAttack: 1, restoreHealth: 1, restoreMaxHealth: 1 };
    const card = makeItemCard({ effectCode: "TANK_FORM", effectParams: { target: "one_warrior" } });
    const ids = getFriendlyWarriorTargets(game, card).map((w) => w.instanceId);
    expect(ids).toEqual([free.instanceId]);
  });
});
