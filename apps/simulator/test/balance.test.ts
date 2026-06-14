/**
 * Balance report tests: a small deterministic sweep, checking the aggregation
 * arithmetic and the formatter, not the balance numbers themselves.
 */
import { loadCards, type Card } from "@euphoria/card-data";
import { beforeAll, describe, expect, it } from "vitest";
import {
  formatBalanceReport,
  generateBalanceReport,
  type BalanceReport,
} from "../src/balance";
import { DECK_FACTIONS } from "../src/deck";

let pool: Card[];
let report: BalanceReport;
beforeAll(() => {
  pool = loadCards();
  // 1 game per matchup = 16 games — small but exercises every faction pairing.
  report = generateBalanceReport({ pool, gamesPerMatchup: 1, seed: 123, maxTurns: 200 });
});

describe("generateBalanceReport", () => {
  it("runs one game per ordered matchup over all four factions", () => {
    expect(report.matchups).toHaveLength(DECK_FACTIONS.length ** 2); // 16
    expect(report.totalGames).toBe(16);
    expect(report.gamesPerMatchup).toBe(1);
    expect(report.matchups.every((m) => m.games === 1)).toBe(true);
  });

  it("never builds a Shaman matchup", () => {
    for (const m of report.matchups) {
      expect(DECK_FACTIONS).toContain(m.player1);
      expect(DECK_FACTIONS).toContain(m.player2);
    }
  });

  it("balances the books: every game lands in exactly one outcome bucket", () => {
    const { player1Wins, player2Wins, draws } = report.seat;
    expect(player1Wins + player2Wins + draws + report.failedGames).toBe(
      report.totalGames,
    );
    // Each completed game is a win, a max-turn draw, or another non-win end.
    expect(
      report.winsByDirectAttack + report.winsByCombat + report.maxTurnGames,
    ).toBeLessThanOrEqual(report.totalGames);
  });

  it("counts each faction's seat-appearances consistently", () => {
    // Across 16 ordered matchups each faction sits in 8 (4 as P1 + 4 as P2).
    for (const faction of DECK_FACTIONS) {
      expect(report.byFaction[faction].games).toBe(8);
      expect(report.byFaction[faction].wins).toBeLessThanOrEqual(8);
    }
    const factionWins = DECK_FACTIONS.reduce(
      (sum, f) => sum + report.byFaction[f].wins,
      0,
    );
    expect(factionWins).toBe(report.seat.player1Wins + report.seat.player2Wins);
  });

  it("splits each faction's record cleanly across the two seats", () => {
    for (const faction of DECK_FACTIONS) {
      const r = report.byFaction[faction];
      // 1 game/matchup: a faction is P1 in 4 matchups and P2 in 4 matchups.
      expect(r.player1Games).toBe(4);
      expect(r.player2Games).toBe(4);
      // Seat totals reconstitute the overall totals exactly.
      expect(r.player1Games + r.player2Games).toBe(r.games);
      expect(r.player1Wins + r.player2Wins).toBe(r.wins);
      // Wins never exceed games in either seat.
      expect(r.player1Wins).toBeLessThanOrEqual(r.player1Games);
      expect(r.player2Wins).toBeLessThanOrEqual(r.player2Games);
    }
  });

  it("reconciles per-faction seat wins with the overall seat tallies", () => {
    const p1 = DECK_FACTIONS.reduce(
      (sum, f) => sum + report.byFaction[f].player1Wins,
      0,
    );
    const p2 = DECK_FACTIONS.reduce(
      (sum, f) => sum + report.byFaction[f].player2Wins,
      0,
    );
    expect(p1).toBe(report.seat.player1Wins);
    expect(p2).toBe(report.seat.player2Wins);
    // Every faction's P1 seat-games sum to the total game count (each game has
    // exactly one P1 faction), and likewise for P2.
    const p1Games = DECK_FACTIONS.reduce(
      (sum, f) => sum + report.byFaction[f].player1Games,
      0,
    );
    expect(p1Games).toBe(report.totalGames);
  });

  it("reports a positive average turn count and direct-attack win method", () => {
    expect(report.avgTurns).toBeGreaterThan(0);
    // Lives only fall to direct attacks today, so combat wins are 0.
    expect(report.winsByCombat).toBe(0);
  });

  it("is deterministic for a fixed seed", () => {
    const again = generateBalanceReport({
      pool,
      gamesPerMatchup: 1,
      seed: 123,
      maxTurns: 200,
    });
    expect(again).toEqual(report);
  });

  it("changes with a different seed", () => {
    const other = generateBalanceReport({
      pool,
      gamesPerMatchup: 1,
      seed: 999,
      maxTurns: 200,
    });
    // Same shape, but the per-matchup outcomes should not be identical.
    expect(other.totalGames).toBe(report.totalGames);
    expect(other.matchups).not.toEqual(report.matchups);
  });
});

describe("formatBalanceReport", () => {
  it("renders the required sections as readable text", () => {
    const text = formatBalanceReport(report);
    expect(text).toContain("win rate by faction");
    expect(text).toContain("as Player 1");
    expect(text).toContain("as Player 2");
    expect(text).toContain("overall seat win rate");
    expect(text).toContain("win rate by matchup");
    expect(text).toContain("win method");
    expect(text).toContain("hit max-turn limit");
    expect(text).toContain("anomalies");
    for (const faction of DECK_FACTIONS) expect(text).toContain(faction);
  });

  it("reports clean state with no errors on a healthy run", () => {
    expect(report.failedGames).toBe(0);
    expect(formatBalanceReport(report)).toContain("top errors: none");
  });
});
