/**
 * Simulator scaffold tests: deck building, the game loop's termination and
 * determinism, the safety caps, and the illegal-action guard.
 */
import { loadCards, type Card } from "@euphoria/card-data";
import { createRng, type GameAction, type PlayerId } from "@euphoria/game-engine";
import { beforeAll, describe, expect, it } from "vitest";
import { greedyAgent, randomAgent, type Agent } from "../src/agents";
import {
  buildDeck,
  buildFactionDeck,
  DECK_FACTIONS,
  DECK_STAPLE_SLUGS,
  type DeckFaction,
} from "../src/deck";
import { runGame } from "../src/runner";

let pool: Card[];
beforeAll(() => {
  pool = loadCards();
});

function decks(seed: number): Record<PlayerId, Card[]> {
  const rng = createRng(seed);
  return { player1: buildDeck(pool, rng), player2: buildDeck(pool, rng) };
}

describe("buildDeck", () => {
  it("produces a full 30-card deck", () => {
    expect(buildDeck(pool, createRng(1))).toHaveLength(30);
  });

  it("honors the requested size and Warrior count", () => {
    const deck = buildDeck(pool, createRng(2), { size: 30, warriorCount: 30 });
    expect(deck).toHaveLength(30);
    expect(deck.every((c) => c.type === "Warrior")).toBe(true);
  });

  it("fills with support cards when no Warriors are requested", () => {
    const deck = buildDeck(pool, createRng(3), { warriorCount: 0 });
    expect(deck.some((c) => c.type !== "Warrior")).toBe(true);
  });

  it("throws on a pool with no Warriors", () => {
    const support = pool.filter((c) => c.type !== "Warrior");
    expect(() => buildDeck(support, createRng(1))).toThrow(/no Warriors/);
  });
});

describe("buildFactionDeck", () => {
  it("excludes Shaman from the buildable factions", () => {
    expect(DECK_FACTIONS).not.toContain("Shaman");
    expect([...DECK_FACTIONS]).toEqual(["Monk", "Surfer", "Dwarf", "Sonic"]);
  });

  it.each(DECK_FACTIONS)("builds a 30-card %s deck of only that faction + Neutral", (faction) => {
    const deck = buildFactionDeck(pool, faction as DeckFaction, createRng(1));
    expect(deck).toHaveLength(30);
    // Every card is the chosen faction or shared Neutral — never another faction.
    expect(deck.every((c) => c.faction === faction || c.faction === "Neutral")).toBe(
      true,
    );
    // Warriors all belong to the faction (Neutral has none); the deck has some.
    const warriors = deck.filter((c) => c.type === "Warrior");
    expect(warriors.length).toBeGreaterThan(0);
    expect(warriors.every((c) => c.faction === faction)).toBe(true);
    // Any Attack cards match the faction (other factions' Attacks are unplayable).
    expect(
      deck.filter((c) => c.type === "Attack").every((c) => c.faction === faction),
    ).toBe(true);
  });

  it("never includes a Shaman card in any faction deck", () => {
    for (const faction of DECK_FACTIONS) {
      const deck = buildFactionDeck(pool, faction, createRng(3));
      expect(deck.some((c) => c.faction === "Shaman")).toBe(false);
    }
  });

  it.each(DECK_FACTIONS)("includes exactly one of each staple in a %s deck", (faction) => {
    const deck = buildFactionDeck(pool, faction as DeckFaction, createRng(9));
    for (const slug of DECK_STAPLE_SLUGS) {
      // Exactly one: guaranteed once, and never re-sampled by the filler.
      expect(deck.filter((c) => c.slug === slug)).toHaveLength(1);
    }
    // Staples are real cards (Lahkt Brand, Totem's Creation, GILs Unit) and
    // the deck is still exactly 30 cards with them included.
    expect(DECK_STAPLE_SLUGS).toEqual([
      "lahkt-brand-family-products",
      "totems-creation",
      "gils-unit",
    ]);
    expect(deck).toHaveLength(30);
  });

  it("plays a cross-faction game to a winner", () => {
    const rng = createRng(4);
    const decks = {
      player1: buildFactionDeck(pool, "Monk", rng),
      player2: buildFactionDeck(pool, "Sonic", rng),
    };
    const result = runGame({
      decks,
      agents: { player1: greedyAgent(), player2: greedyAgent() },
      seed: 4,
    });
    expect(result.reason).toBe("win");
  });
});

describe("runGame", () => {
  const greedy = () => ({ player1: greedyAgent(), player2: greedyAgent() });

  it("plays a greedy mirror match to a winner", () => {
    const result = runGame({ decks: decks(1), agents: greedy(), seed: 1 });
    expect(result.reason).toBe("win");
    expect(result.winner === "player1" || result.winner === "player2").toBe(true);
    // The winner ended the loser at 0 lives.
    const loser: PlayerId = result.winner === "player1" ? "player2" : "player1";
    expect(result.finalLives[loser]).toBe(0);
  });

  it("is deterministic for a fixed seed and decks", () => {
    const a = runGame({ decks: decks(7), agents: greedy(), seed: 7 });
    const b = runGame({ decks: decks(7), agents: greedy(), seed: 7 });
    expect(a).toEqual(b);
  });

  it("never lets an agent submit an illegal action (random play does not throw)", () => {
    const agents = { player1: randomAgent(11), player2: randomAgent(22) };
    const result = runGame({ decks: decks(5), agents, seed: 5, maxTurns: 60 });
    expect(["win", "maxTurns", "maxActions"]).toContain(result.reason);
  });

  it("respects the maxTurns cap when no one has won yet", () => {
    const result = runGame({ decks: decks(1), agents: greedy(), seed: 1, maxTurns: 2 });
    expect(result.reason).toBe("maxTurns");
    expect(result.winner).toBeNull();
    expect(result.turns).toBeLessThanOrEqual(3);
  });

  it("throws if an agent returns an illegal action (loop trusts the engine)", () => {
    const rogue: Agent = () =>
      ({
        kind: "attack",
        attackerInstanceId: "no-such-warrior",
        defenderInstanceId: "no-such-warrior",
      }) satisfies GameAction;
    expect(() =>
      runGame({
        decks: decks(1),
        agents: { player1: rogue, player2: greedyAgent() },
        seed: 1,
      }),
    ).toThrow(/illegal attack/);
  });
});
