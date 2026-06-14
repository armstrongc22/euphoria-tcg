/**
 * Tests for the smarter agent and the Monk comparison harness. Structural and
 * deterministic — they check that the smart agent stays legal and behaves as
 * designed, and that the comparison arithmetic reconciles.
 */
import { loadCards, type Card } from "@euphoria/card-data";
import {
  applyAction,
  createGame,
  createRng,
  getLegalActions,
  type GameState,
} from "@euphoria/game-engine";
import { beforeAll, describe, expect, it } from "vitest";
import { smartAgent } from "../src/agents";
import { buildFactionDeck } from "../src/deck";
import { compareMonk, type MonkComparison } from "../src/monk-compare";

let pool: Card[];
beforeAll(() => {
  pool = loadCards();
});

describe("smartAgent", () => {
  it("only ever returns a legal action across a full game", () => {
    const decks = {
      player1: buildFactionDeck(pool, "Monk", createRng(1)),
      player2: buildFactionDeck(pool, "Dwarf", createRng(1)),
    };
    let state = createGame({ decks, seed: 1 });
    const agent = smartAgent();
    for (let i = 0; i < 500 && state.winner === null; i++) {
      const legal = getLegalActions(state);
      if (legal.length === 0) break;
      const action = agent(state, legal);
      expect(legal).toContainEqual(action);
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }
  });

  it("summons the cheapest affordable Warrior first (Spirit efficiency)", () => {
    const cheap = pool.find((c) => c.type === "Warrior" && c.cost === 1)!;
    const dear = pool.find(
      (c) => c.type === "Warrior" && c.cost === 3 && c.id !== cheap.id,
    )!;
    expect(cheap).toBeDefined();
    expect(dear).toBeDefined();

    const game = createGame({
      decks: {
        player1: buildFactionDeck(pool, "Monk", createRng(1)),
        player2: buildFactionDeck(pool, "Dwarf", createRng(1)),
      },
      seed: 1,
    });
    // Main phase, player1 active. Stage a hand with both costs and enough Spirit.
    const state: GameState = structuredClone(game);
    state.players.player1.spirit = 3;
    state.players.player1.hand = [dear, cheap];

    const summonOptions = getLegalActions(state).filter(
      (a) => a.kind === "playWarrior",
    );
    expect(summonOptions).toHaveLength(2);
    const choice = smartAgent()(state, summonOptions);
    expect(choice).toEqual({ kind: "playWarrior", cardId: cheap.id });
  });
});

describe("compareMonk", () => {
  let cmp: MonkComparison;
  beforeAll(() => {
    cmp = compareMonk(pool, [1, 2, 3]); // small deterministic sample
  });

  it("runs Monk in both seats vs all three opponents under each agent", () => {
    for (const label of ["greedy", "smart"] as const) {
      const r = cmp[label];
      // 3 seeds x 3 opponents x (P1 + P2) = 18 overall games.
      expect(r.overall.games).toBe(18);
      expect(r.overall.p1Games).toBe(9);
      expect(r.overall.p2Games).toBe(9);
      for (const opp of ["Dwarf", "Sonic", "Surfer"] as const) {
        expect(r.byOpponent[opp].games).toBe(6); // 3 seeds x 2 seats
      }
      expect(r.mirrorGames).toBe(3);
    }
  });

  it("reconciles per-opponent and per-seat aggregates into the overall total", () => {
    for (const label of ["greedy", "smart"] as const) {
      const r = cmp[label];
      const opponents = ["Dwarf", "Sonic", "Surfer"] as const;
      expect(opponents.reduce((s, o) => s + r.byOpponent[o].games, 0)).toBe(
        r.overall.games,
      );
      expect(opponents.reduce((s, o) => s + r.byOpponent[o].wins, 0)).toBe(
        r.overall.wins,
      );
      expect(r.overall.p1Games + r.overall.p2Games).toBe(r.overall.games);
      expect(r.overall.p1Wins + r.overall.p2Wins).toBe(r.overall.wins);
    }
  });

  it("is deterministic for fixed seeds", () => {
    expect(compareMonk(pool, [1, 2, 3])).toEqual(cmp);
  });
});
