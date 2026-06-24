/**
 * Match history — PURE logic, no DOM, no network. Two concerns:
 *
 *   1. Turning a finished {@link MatchSummary} into the flat row we persist
 *      (buildMatchHistoryInsert), and computing account stats from a list of
 *      rows (computeAccountStats / recentMatches).
 *   2. The LOCAL/DEMO persistence layer (loadLocalMatches / appendLocalMatch),
 *      used by createLocalAuth when Supabase isn't configured so the demo flow
 *      still shows real stats. Storage is injected via {@link KeyValueStore},
 *      so it's fully unit-testable without a browser.
 *
 * The Supabase backend (auth.ts) writes the same row shape to a `match_history`
 * table; nothing here imports the Supabase SDK.
 */
import type { MatchOutcome, MatchSummary } from "./match";
import type { KeyValueStore } from "@euphoria/core/signup";
import { STARTER_FACTIONS, type StarterFaction } from "@euphoria/core/starter";

/** localStorage key. Versioned so the shape can change later without clashes. */
export const MATCH_STORAGE_KEY = "euphoria.matches.v1";

/**
 * The columns we insert per completed match. `created_at` is intentionally
 * omitted — the DB default sets it on insert (and the local layer adds it when
 * it writes a record), mirroring buildProfilePayload in auth.ts.
 */
export interface MatchHistoryInsert {
  readonly user_id: string;
  readonly player_faction: StarterFaction;
  readonly opponent_faction: StarterFaction;
  /** The winning faction, or "draw". */
  readonly winner: string;
  /** Outcome from the player's point of view. */
  readonly result: MatchOutcome;
  readonly turns: number;
  readonly lives_left_player: number;
  readonly lives_left_opponent: number;
  readonly warriors_summoned_player: number;
  readonly warriors_summoned_opponent: number;
  readonly direct_attacks_player: number;
  readonly direct_attacks_opponent: number;
}

/** A persisted match row: the inserted columns plus the DB/local timestamp. */
export interface MatchRecord extends MatchHistoryInsert {
  readonly created_at: string;
}

/** Aggregate stats shown on the account page. */
export interface AccountStats {
  readonly total: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Wins ÷ total, in [0, 1]; 0 when no matches have been played. */
  readonly winRate: number;
}

/** Stats for a player who hasn't played yet (or when history can't load). */
export const EMPTY_STATS: AccountStats = {
  total: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: 0,
};

/**
 * Builds the insert payload for one finished match. Pure and deterministic —
 * derived entirely from the summary the simulator produced, so the stored row
 * matches what the player saw. The simulator's outcome logic is not touched.
 */
export function buildMatchHistoryInsert(
  userId: string,
  summary: MatchSummary,
): MatchHistoryInsert {
  const r = summary.result;
  const winner =
    summary.outcome === "draw"
      ? "draw"
      : summary.playerWon
        ? summary.playerFaction
        : summary.opponentFaction;
  return {
    user_id: userId,
    player_faction: summary.playerFaction,
    opponent_faction: summary.opponentFaction,
    winner,
    result: summary.outcome,
    turns: summary.turns,
    lives_left_player: r.finalLives.player1,
    lives_left_opponent: r.finalLives.player2,
    warriors_summoned_player: r.summons.player1,
    warriors_summoned_opponent: r.summons.player2,
    direct_attacks_player: r.directAttacks.player1,
    direct_attacks_opponent: r.directAttacks.player2,
  };
}

/** Tallies wins / losses / draws and the win rate over a set of match rows. */
export function computeAccountStats(
  records: readonly Pick<MatchRecord, "result">[],
): AccountStats {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const record of records) {
    if (record.result === "win") wins += 1;
    else if (record.result === "loss") losses += 1;
    else draws += 1;
  }
  const total = records.length;
  return { total, wins, losses, draws, winRate: total > 0 ? wins / total : 0 };
}

/** Win rate as a rounded whole-percent string, e.g. 0.6667 → "67%". */
export function formatWinRate(winRate: number): string {
  return `${Math.round(winRate * 100)}%`;
}

/** The `n` most recent matches, newest first (by created_at). Does not mutate. */
export function recentMatches(
  records: readonly MatchRecord[],
  n = 5,
): MatchRecord[] {
  return [...records]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}

// --- Local (demo) persistence ----------------------------------------------

function isStarterFaction(value: unknown): value is StarterFaction {
  return (
    typeof value === "string" &&
    (STARTER_FACTIONS as readonly string[]).includes(value)
  );
}

function isOutcome(value: unknown): value is MatchOutcome {
  return value === "win" || value === "loss" || value === "draw";
}

/** Narrows an unknown parsed value to a MatchRecord, dropping anything bad. */
function isMatchRecord(value: unknown): value is MatchRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["user_id"] === "string" &&
    isStarterFaction(v["player_faction"]) &&
    isStarterFaction(v["opponent_faction"]) &&
    typeof v["winner"] === "string" &&
    isOutcome(v["result"]) &&
    typeof v["turns"] === "number" &&
    typeof v["created_at"] === "string"
  );
}

/** Reads persisted local matches, or [] if absent/corrupt. Never throws. */
export function loadLocalMatches(store: KeyValueStore): MatchRecord[] {
  const raw = store.getItem(MATCH_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMatchRecord);
  } catch {
    return [];
  }
}

/**
 * Appends one match to local storage, stamping created_at (the local mirror of
 * the DB default), and returns the stored record.
 */
export function appendLocalMatch(
  store: KeyValueStore,
  insert: MatchHistoryInsert,
  now: Date = new Date(),
): MatchRecord {
  const record: MatchRecord = { ...insert, created_at: now.toISOString() };
  const all = loadLocalMatches(store);
  all.push(record);
  store.setItem(MATCH_STORAGE_KEY, JSON.stringify(all));
  return record;
}
