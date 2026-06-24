/**
 * Match history: payload creation from a finished match, stat calculation,
 * recent-match ordering, and the local-storage persistence used as the
 * Supabase fallback. Pure/node — no DOM, no network.
 */
import { describe, expect, it } from "vitest";
import type { GameResult } from "@euphoria/simulator";
import { cards } from "@euphoria/core/cards";
import { runTestMatch, type MatchOutcome, type MatchSummary } from "../src/match";
import {
  appendLocalMatch,
  buildMatchHistoryInsert,
  computeAccountStats,
  EMPTY_STATS,
  formatWinRate,
  loadLocalMatches,
  recentMatches,
  type MatchRecord,
} from "../src/match-history";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A controllable MatchSummary so winner/result mapping can be asserted. */
function fakeSummary(outcome: MatchOutcome): MatchSummary {
  const playerWon = outcome === "win";
  const result: GameResult = {
    winner: outcome === "draw" ? null : playerWon ? "player1" : "player2",
    reason: outcome === "draw" ? "maxTurns" : "win",
    turns: 18,
    actions: 99,
    events: 42,
    finalLives: { player1: playerWon ? 3 : 0, player2: playerWon ? 0 : 3 },
    winByDirectAttack: outcome !== "draw",
    effectFallbacks: 0,
    deckOuts: 0,
    summons: { player1: 8, player2: 7 },
    warriorsLost: { player1: 2, player2: 5 },
    directAttacks: { player1: playerWon ? 3 : 0, player2: playerWon ? 0 : 3 },
  };
  return {
    playerFaction: "Sonic",
    opponentFaction: "Dwarf",
    outcome,
    playerWon,
    winnerLabel: playerWon ? "You" : outcome === "draw" ? "Draw" : "Dwarf",
    turns: 18,
    highlights: ["x"],
    result,
    seed: 1,
  };
}

describe("buildMatchHistoryInsert", () => {
  it("maps every required column from the summary", () => {
    const insert = buildMatchHistoryInsert("user-1", fakeSummary("win"));
    expect(insert).toEqual({
      user_id: "user-1",
      player_faction: "Sonic",
      opponent_faction: "Dwarf",
      winner: "Sonic",
      result: "win",
      turns: 18,
      lives_left_player: 3,
      lives_left_opponent: 0,
      warriors_summoned_player: 8,
      warriors_summoned_opponent: 7,
      direct_attacks_player: 3,
      direct_attacks_opponent: 0,
    });
    // created_at is set by the DB default / local layer, not the payload.
    expect(insert).not.toHaveProperty("created_at");
  });

  it("names the opponent faction as winner on a loss", () => {
    expect(buildMatchHistoryInsert("u", fakeSummary("loss")).winner).toBe("Dwarf");
  });

  it("records 'draw' as the winner on a draw", () => {
    expect(buildMatchHistoryInsert("u", fakeSummary("draw")).winner).toBe("draw");
  });

  it("stays consistent with a real simulated match", () => {
    const summary = runTestMatch({ faction: "Monk", pool: cards, seed: 5 });
    const insert = buildMatchHistoryInsert("u", summary);
    expect(insert.player_faction).toBe(summary.playerFaction);
    expect(insert.opponent_faction).toBe(summary.opponentFaction);
    expect(insert.result).toBe(summary.outcome);
    expect(insert.turns).toBe(summary.turns);
    expect(insert.lives_left_player).toBe(summary.result.finalLives.player1);
    expect(insert.direct_attacks_opponent).toBe(summary.result.directAttacks.player2);
  });
});

describe("computeAccountStats", () => {
  it("returns empty stats for no matches", () => {
    expect(computeAccountStats([])).toEqual(EMPTY_STATS);
  });

  it("tallies wins, losses, draws, and the win rate", () => {
    const stats = computeAccountStats([
      { result: "win" },
      { result: "win" },
      { result: "loss" },
      { result: "draw" },
    ]);
    expect(stats).toEqual({
      total: 4,
      wins: 2,
      losses: 1,
      draws: 1,
      winRate: 0.5,
    });
  });

  it("formats the win rate as a whole percent", () => {
    expect(formatWinRate(computeAccountStats([
      { result: "win" }, { result: "win" }, { result: "loss" },
    ]).winRate)).toBe("67%");
    expect(formatWinRate(0)).toBe("0%");
  });
});

describe("recentMatches", () => {
  const rec = (id: string, created_at: string): MatchRecord => ({
    user_id: "u",
    player_faction: "Sonic",
    opponent_faction: "Dwarf",
    winner: id,
    result: "win",
    turns: 10,
    lives_left_player: 3,
    lives_left_opponent: 0,
    warriors_summoned_player: 1,
    warriors_summoned_opponent: 1,
    direct_attacks_player: 3,
    direct_attacks_opponent: 0,
    created_at,
  });

  it("returns the newest matches first, capped at n", () => {
    const records = [
      rec("a", "2026-06-01T00:00:00Z"),
      rec("b", "2026-06-03T00:00:00Z"),
      rec("c", "2026-06-02T00:00:00Z"),
    ];
    const recent = recentMatches(records, 2);
    expect(recent.map((r) => r.winner)).toEqual(["b", "c"]);
    // Input is not mutated.
    expect(records.map((r) => r.winner)).toEqual(["a", "b", "c"]);
  });
});

describe("local persistence (Supabase fallback)", () => {
  it("round-trips appended matches", () => {
    const store = memoryStore();
    expect(loadLocalMatches(store)).toEqual([]);
    appendLocalMatch(store, buildMatchHistoryInsert("u", fakeSummary("win")));
    appendLocalMatch(store, buildMatchHistoryInsert("u", fakeSummary("loss")));
    const all = loadLocalMatches(store);
    expect(all).toHaveLength(2);
    expect(computeAccountStats(all)).toMatchObject({ total: 2, wins: 1, losses: 1 });
  });

  it("returns [] on corrupt storage rather than throwing", () => {
    const store = memoryStore();
    store.setItem("euphoria.matches.v1", "{not json");
    expect(loadLocalMatches(store)).toEqual([]);
  });
});
