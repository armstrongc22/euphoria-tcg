/**
 * CLI for the Monk smarter-agent validation. Runs the Monk matchups under the
 * greedy and smart agents and prints a side-by-side comparison. Instrumentation
 * only — no card or deck changes.
 *
 *   npm run sim:monk-compare -- --seeds 60 --seed 100
 */
import { loadCards } from "@euphoria/card-data";
import { compareMonk, formatMonkComparison } from "./monk-compare";

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} expects a number, got "${process.argv[i + 1]}"`);
  }
  return value;
}

const count = flag("seeds", 60);
const base = flag("seed", 100);
const seeds = Array.from({ length: count }, (_, i) => base + i);

console.log(formatMonkComparison(compareMonk(loadCards(), seeds)));
