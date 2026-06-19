/**
 * Crash/refresh recovery for an in-progress live match. PURE logic + an injected
 * {@link KeyValueStore}, so it's fully unit-testable without a browser.
 *
 * A live match is fully determined by its seed, the player's faction/deck, and
 * the ordered list of human actions (the opponent is a deterministic function of
 * state — see play-match.ts). So to survive a mobile tab reload we persist just
 * that descriptor and, on return, rebuild the match by replaying the actions
 * (createPlayableMatch({ replay })). Nothing here imports the engine or DOM.
 *
 * Storage is sessionStorage by default (per-tab; cleared when the tab closes, but
 * preserved across an in-tab reload — exactly the recovery window we want).
 */
import type { GameAction } from "@euphoria/game-engine";
import { STARTER_FACTIONS, type DeckEntry, type StarterFaction } from "./starter";
import type { KeyValueStore } from "./signup";

/** sessionStorage key. Versioned so the shape can change without clashing. */
export const ACTIVE_MATCH_KEY = "euphoria.activeMatch.v1";

/** Bumped when {@link SavedMatch}'s shape changes, to invalidate old saves. */
export const SAVE_VERSION = 1;

/** Everything needed to deterministically rebuild an interrupted match. */
export interface SavedMatch {
  readonly version: number;
  /** Scopes the save to the signed-in user (no cross-account resume). */
  readonly userId: string;
  readonly faction: StarterFaction;
  readonly opponentFaction: StarterFaction;
  readonly seed: number;
  /** Custom-deck entries when one was used, else null (the starter deck). */
  readonly playerDeck: readonly DeckEntry[] | null;
  /** Ordered human actions to replay. */
  readonly actions: readonly GameAction[];
  /** Turn number when saved — for the "Resume match?" prompt. */
  readonly turn: number;
  readonly savedAt: string;
}

/** The fields a caller supplies; version/savedAt are stamped here. */
export type SavedMatchInput = Omit<SavedMatch, "version" | "savedAt">;

function isStarterFaction(value: unknown): value is StarterFaction {
  return (
    typeof value === "string" &&
    (STARTER_FACTIONS as readonly string[]).includes(value)
  );
}

function isDeckEntryArray(value: unknown): value is DeckEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as DeckEntry).slug === "string" &&
        typeof (e as DeckEntry).quantity === "number",
    )
  );
}

/** Narrows an unknown parsed value to a current-version SavedMatch, or null. */
export function coerceSavedMatch(value: unknown): SavedMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v["version"] !== SAVE_VERSION) return null;
  if (typeof v["userId"] !== "string" || v["userId"].length === 0) return null;
  if (!isStarterFaction(v["faction"])) return null;
  if (!isStarterFaction(v["opponentFaction"])) return null;
  if (typeof v["seed"] !== "number") return null;
  if (!Array.isArray(v["actions"])) return null;
  if (typeof v["turn"] !== "number") return null;
  if (typeof v["savedAt"] !== "string") return null;
  const deck = v["playerDeck"];
  if (deck !== null && !isDeckEntryArray(deck)) return null;
  // Individual actions aren't deeply validated here — the replay re-applies them
  // through the engine, which rejects anything that no longer fits (the caller
  // then discards the save). We only guard the envelope so JSON corruption or a
  // version bump can't crash the resume prompt.
  return {
    version: SAVE_VERSION,
    userId: v["userId"],
    faction: v["faction"],
    opponentFaction: v["opponentFaction"],
    seed: v["seed"],
    playerDeck: deck === null ? null : (deck as DeckEntry[]),
    actions: v["actions"] as GameAction[],
    turn: v["turn"],
    savedAt: v["savedAt"],
  };
}

/** Persists the current in-progress match (best-effort; never throws). */
export function saveActiveMatch(
  store: KeyValueStore,
  input: SavedMatchInput,
  now: Date = new Date(),
): void {
  const record: SavedMatch = {
    ...input,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
  };
  try {
    store.setItem(ACTIVE_MATCH_KEY, JSON.stringify(record));
  } catch {
    /* storage full/blocked — recovery is best-effort, never break the match */
  }
}

/** Loads a saved match for `userId`, or null if absent/corrupt/another user's. */
export function loadActiveMatch(
  store: KeyValueStore,
  userId: string,
): SavedMatch | null {
  const raw = store.getItem(ACTIVE_MATCH_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const saved = coerceSavedMatch(parsed);
  if (saved === null || saved.userId !== userId) return null;
  return saved;
}

/** Removes any saved match (call on completion, quit, or a failed resume). */
export function clearActiveMatch(store: KeyValueStore): void {
  try {
    store.removeItem(ACTIVE_MATCH_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Returns a usable sessionStorage, or null when unavailable/blocked (private
 * mode, SSR, disabled storage). The match simply runs without recovery then.
 */
export function getSessionStore(): KeyValueStore | null {
  try {
    const ss = globalThis.sessionStorage as KeyValueStore | undefined;
    if (!ss) return null;
    const probe = "__euphoria_probe__";
    ss.setItem(probe, "1");
    ss.removeItem(probe);
    return ss;
  } catch {
    return null;
  }
}
