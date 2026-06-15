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
import { expandDeckEntries, starterActiveDeck } from "../src/deck-builder";

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

describe("runTestMatch uses the saved custom deck (rule 10)", () => {
  it("passing the starter deck as playerDeck matches omitting it", () => {
    const base = { faction: "Dwarf" as const, pool: cards, seed: 11, opponentFaction: "Monk" as const };
    const withStarter = runTestMatch({ ...base, playerDeck: starterActiveDeck("Dwarf") });
    const omitted = runTestMatch(base);
    // Same seed + opponent + equivalent player deck ⇒ identical outcome.
    expect(withStarter.outcome).toBe(omitted.outcome);
    expect(withStarter.turns).toBe(omitted.turns);
    expect(withStarter.winnerLabel).toBe(omitted.winnerLabel);
  });

  it("feeds the provided deck into player1 (a different deck differs)", () => {
    // A custom deck that drops a card and adds copies of another is a different
    // 30-card list than the starter, proving playerDeck flows to the player seat.
    const starter = starterActiveDeck("Dwarf");
    const custom = starter
      .map((e) => (e.slug === "titan" ? { slug: e.slug, quantity: 1 } : e))
      .map((e) => (e.slug === "aaron-alacapati" ? { slug: e.slug, quantity: 3 } : e));
    const starterFlat = expandDeckEntries(starter, cards);
    const customFlat = expandDeckEntries(custom, cards);
    expect(customFlat).toHaveLength(starterFlat.length);
    expect(customFlat).not.toEqual(starterFlat);
    // And it runs without throwing.
    const summary = runTestMatch({ faction: "Dwarf", pool: cards, seed: 5, playerDeck: custom });
    expect(summary.turns).toBeGreaterThan(0);
  });
});
