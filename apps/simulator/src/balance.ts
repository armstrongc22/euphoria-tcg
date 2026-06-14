/**
 * Balance instrumentation: runs greedy-vs-greedy games across every ordered
 * faction matchup and aggregates the outcomes. This is measurement only — it
 * touches no card data, stats, or deck rules — so the numbers describe the
 * current engine + agents, not a balance verdict.
 *
 * `generateBalanceReport` is deterministic for a given seed (pure over the
 * card pool), and `formatBalanceReport` renders it for the terminal; keeping
 * them separate makes the aggregator testable without parsing printed text.
 */
import type { Card } from "@euphoria/card-data";
import { createRng, type PlayerId } from "@euphoria/game-engine";
import { greedyAgent } from "./agents";
import { buildFactionDeck, DECK_FACTIONS, type DeckFaction } from "./deck";
import { runGame } from "./runner";

export interface FactionRecord {
  /** Seat-appearances: a mirror match counts the faction twice. */
  games: number;
  wins: number;
}

export interface MatchupRecord {
  player1: DeckFaction;
  player2: DeckFaction;
  games: number;
  player1Wins: number;
  player2Wins: number;
  draws: number;
}

export interface BalanceReport {
  seed: number;
  gamesPerMatchup: number;
  totalGames: number;
  avgTurns: number;
  byFaction: Record<DeckFaction, FactionRecord>;
  matchups: MatchupRecord[];
  seat: { player1Wins: number; player2Wins: number; draws: number };
  winsByDirectAttack: number;
  winsByCombat: number;
  maxTurnGames: number;
  effectFallbacks: number;
  deckOuts: number;
  /** Thrown-error message -> occurrences (agent/engine faults; 0 when healthy). */
  errors: Record<string, number>;
  failedGames: number;
}

export interface BalanceOptions {
  pool: Card[];
  /** Games per ordered matchup. Total games = this x DECK_FACTIONS^2. */
  gamesPerMatchup: number;
  seed: number;
  maxTurns?: number;
}

/** Runs the full matchup sweep and returns aggregated, deterministic stats. */
export function generateBalanceReport(options: BalanceOptions): BalanceReport {
  const { pool, gamesPerMatchup, seed, maxTurns } = options;

  const byFaction = Object.fromEntries(
    DECK_FACTIONS.map((f) => [f, { games: 0, wins: 0 }]),
  ) as Record<DeckFaction, FactionRecord>;
  const matchups: MatchupRecord[] = [];
  const seat = { player1Wins: 0, player2Wins: 0, draws: 0 };
  const errors: Record<string, number> = {};

  let totalGames = 0;
  let totalTurns = 0;
  let winsByDirectAttack = 0;
  let winsByCombat = 0;
  let maxTurnGames = 0;
  let effectFallbacks = 0;
  let deckOuts = 0;
  let failedGames = 0;

  let matchupIndex = 0;
  for (const p1 of DECK_FACTIONS) {
    for (const p2 of DECK_FACTIONS) {
      const record: MatchupRecord = {
        player1: p1,
        player2: p2,
        games: 0,
        player1Wins: 0,
        player2Wins: 0,
        draws: 0,
      };
      for (let g = 0; g < gamesPerMatchup; g++) {
        // Distinct, reproducible seed per game so the sweep is deterministic.
        const gameSeed = seed + matchupIndex * 1000 + g;
        const rng = createRng(gameSeed);
        const decks: Record<PlayerId, Card[]> = {
          player1: buildFactionDeck(pool, p1, rng),
          player2: buildFactionDeck(pool, p2, rng),
        };
        try {
          const result = runGame({
            decks,
            agents: { player1: greedyAgent(), player2: greedyAgent() },
            seed: gameSeed,
            maxTurns,
          });
          totalGames += 1;
          totalTurns += result.turns;
          record.games += 1;
          byFaction[p1].games += 1;
          byFaction[p2].games += 1;

          if (result.winner === "player1") {
            record.player1Wins += 1;
            byFaction[p1].wins += 1;
            seat.player1Wins += 1;
          } else if (result.winner === "player2") {
            record.player2Wins += 1;
            byFaction[p2].wins += 1;
            seat.player2Wins += 1;
          } else {
            record.draws += 1;
            seat.draws += 1;
          }

          if (result.reason === "win") {
            if (result.winByDirectAttack) winsByDirectAttack += 1;
            else winsByCombat += 1;
          }
          if (result.reason === "maxTurns") maxTurnGames += 1;
          effectFallbacks += result.effectFallbacks;
          deckOuts += result.deckOuts;
        } catch (error) {
          failedGames += 1;
          const message = error instanceof Error ? error.message : String(error);
          errors[message] = (errors[message] ?? 0) + 1;
        }
      }
      matchups.push(record);
      matchupIndex += 1;
    }
  }

  return {
    seed,
    gamesPerMatchup,
    totalGames,
    avgTurns: totalGames > 0 ? totalTurns / totalGames : 0,
    byFaction,
    matchups,
    seat,
    winsByDirectAttack,
    winsByCombat,
    maxTurnGames,
    effectFallbacks,
    deckOuts,
    errors,
    failedGames,
  };
}

function pct(n: number, of: number): string {
  return of > 0 ? `${((100 * n) / of).toFixed(1)}%` : "—";
}

/** Renders a report as a readable, fixed-width terminal block. */
export function formatBalanceReport(report: BalanceReport): string {
  const lines: string[] = [];
  lines.push("=== Euphoria balance report (instrumentation only) ===");
  lines.push(
    `seed ${report.seed} · ${report.gamesPerMatchup} game(s)/matchup · ${report.totalGames} games · avg ${report.avgTurns.toFixed(1)} turns`,
  );

  lines.push("");
  lines.push("win rate by faction (across both seats):");
  for (const faction of DECK_FACTIONS) {
    const r = report.byFaction[faction];
    lines.push(
      `  ${faction.padEnd(7)} ${String(r.wins).padStart(4)}/${String(r.games).padEnd(4)}  ${pct(r.wins, r.games)}`,
    );
  }

  lines.push("");
  lines.push("win rate by matchup (player1 perspective):");
  lines.push("  P1      vs P2        games   P1win  P2win  draw   P1%");
  for (const m of report.matchups) {
    lines.push(
      `  ${m.player1.padEnd(7) } ${m.player2.padEnd(9)} ${String(m.games).padStart(5)}  ${String(
        m.player1Wins,
      ).padStart(5)}  ${String(m.player2Wins).padStart(5)}  ${String(m.draws).padStart(4)}  ${pct(
        m.player1Wins,
        m.games,
      ).padStart(6)}`,
    );
  }

  lines.push("");
  lines.push("outcomes:");
  lines.push(
    `  seat wins: player1 ${report.seat.player1Wins} | player2 ${report.seat.player2Wins} | draws ${report.seat.draws}`,
  );
  lines.push(
    `  win method: direct-attack ${report.winsByDirectAttack} | combat ${report.winsByCombat}` +
      "   (lives only fall to direct attacks today, so combat wins are 0 by construction)",
  );
  lines.push(`  hit max-turn limit: ${report.maxTurnGames}`);
  lines.push(
    `  anomalies: effect fallbacks ${report.effectFallbacks} | deck-outs ${report.deckOuts} | failed games ${report.failedGames}`,
  );
  const errorEntries = Object.entries(report.errors).sort((a, b) => b[1] - a[1]);
  if (errorEntries.length > 0) {
    lines.push("  top errors:");
    for (const [message, count] of errorEntries.slice(0, 5)) {
      lines.push(`    ${count}x  ${message}`);
    }
  } else {
    lines.push("  top errors: none");
  }

  return lines.join("\n");
}
