/**
 * Local test-match logic: deck expansion from frozen starter recipes, valid
 * opponent selection, running a match for a selected faction, and the summary
 * it produces. Pure logic — no DOM, no auth, reusing the simulator's runGame.
 */
import { describe, expect, it } from "vitest";
import { createRng } from "@euphoria/game-engine";
import { cards } from "../src/cards";
import {
  expandStarterDeck,
  pickOpponentFaction,
  runTestMatch,
} from "../src/match";
import { STARTER_DECK_SIZE, STARTER_FACTIONS } from "../src/starter";

describe("expandStarterDeck", () => {
  it.each(STARTER_FACTIONS)("expands the %s recipe to a full deck", (faction) => {
    const deck = expandStarterDeck(faction, cards);
    expect(deck).toHaveLength(STARTER_DECK_SIZE);
    expect(deck.every((c) => c !== undefined)).toBe(true);
  });
});

describe("pickOpponentFaction", () => {
  it("never picks the player's own faction", () => {
    for (const faction of STARTER_FACTIONS) {
      for (let seed = 0; seed < 40; seed++) {
        const opp = pickOpponentFaction(faction, createRng(seed));
        expect(opp).not.toBe(faction);
        expect(STARTER_FACTIONS).toContain(opp);
      }
    }
  });
});

describe("runTestMatch", () => {
  it("starts a match from a selected faction and reports both seats", () => {
    const summary = runTestMatch({ faction: "Sonic", pool: cards, seed: 1 });
    expect(summary.playerFaction).toBe("Sonic");
    expect(STARTER_FACTIONS).toContain(summary.opponentFaction);
    expect(summary.opponentFaction).not.toBe("Sonic");
  });

  it("generates a non-empty result summary", () => {
    const summary = runTestMatch({ faction: "Dwarf", pool: cards, seed: 7 });
    expect(["win", "loss", "draw"]).toContain(summary.outcome);
    expect(summary.turns).toBeGreaterThan(0);
    expect(summary.highlights.length).toBeGreaterThan(0);
    expect(summary.playerWon).toBe(summary.outcome === "win");
    // The winner label is consistent with the outcome.
    if (summary.outcome === "win") expect(summary.winnerLabel).toBe("You");
    if (summary.outcome === "draw") expect(summary.winnerLabel).toBe("Draw");
    if (summary.outcome === "loss") {
      expect(summary.winnerLabel).toBe(summary.opponentFaction);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = runTestMatch({ faction: "Monk", pool: cards, seed: 42 });
    const b = runTestMatch({ faction: "Monk", pool: cards, seed: 42 });
    expect(b.opponentFaction).toBe(a.opponentFaction);
    expect(b.outcome).toBe(a.outcome);
    expect(b.turns).toBe(a.turns);
  });

  it("honors an explicit opponent faction", () => {
    const summary = runTestMatch({
      faction: "Surfer",
      pool: cards,
      seed: 3,
      opponentFaction: "Dwarf",
    });
    expect(summary.opponentFaction).toBe("Dwarf");
  });
});
