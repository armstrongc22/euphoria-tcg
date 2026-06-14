/**
 * CLI for the balance report. Sweeps every faction matchup and prints the
 * aggregated stats. Instrumentation only — no card or deck changes.
 *
 *   npm run sim:balance -- --games 20 --seed 123 [--max-turns 200]
 *
 * `--games` is games per ordered matchup (16 matchups for the 4 factions).
 */
import { loadCards } from "@euphoria/card-data";
import { formatBalanceReport, generateBalanceReport } from "./balance";

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} expects a number, got "${process.argv[i + 1]}"`);
  }
  return value;
}

const gamesPerMatchup = flag("games", 10);
const seed = flag("seed", 1);
const maxTurns = flag("max-turns", 200);

const report = generateBalanceReport({
  pool: loadCards(),
  gamesPerMatchup,
  seed,
  maxTurns,
});

console.log(formatBalanceReport(report));
