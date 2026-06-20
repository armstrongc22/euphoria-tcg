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
 * Storage is localStorage (see {@link getRecoveryStore}): a mobile browser that
 * kills a backgrounded tab and reloads it as a fresh navigation loses
 * sessionStorage, so the recovery record MUST outlive the tab session. It's only
 * cleared on match end, concede, explicit discard, or a proven-invalid replay.
 */
import type { GameAction } from "@euphoria/game-engine";
import { STARTER_FACTIONS, type DeckEntry, type StarterFaction } from "./starter";
import type { KeyValueStore } from "./signup";

/** localStorage key. Versioned so the shape can change without clashing. */
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
): boolean {
  const record: SavedMatch = {
    ...input,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
  };
  try {
    store.setItem(ACTIVE_MATCH_KEY, JSON.stringify(record));
    return true;
  } catch {
    // Storage full/blocked (e.g. quota exceeded) — recovery is best-effort and
    // must never break the match. Caller can surface this via diagnostics.
    return false;
  }
}

/** The current saved-snapshot's size (bytes) and age, for the debug panel. */
export interface SnapshotInfo {
  readonly exists: boolean;
  readonly bytes: number;
  readonly turn: number | null;
  readonly savedAt: string | null;
  /** Age in seconds, or null when absent. */
  readonly ageSeconds: number | null;
  /** A validation/availability problem, or null when fine. */
  readonly problem: string | null;
}

/** Inspects the saved snapshot for `userId` without rebuilding the match. */
export function snapshotInfo(
  store: KeyValueStore,
  userId: string,
  now: Date = new Date(),
): SnapshotInfo {
  const empty: SnapshotInfo = {
    exists: false,
    bytes: 0,
    turn: null,
    savedAt: null,
    ageSeconds: null,
    problem: null,
  };
  let raw: string | null;
  try {
    raw = store.getItem(ACTIVE_MATCH_KEY);
  } catch {
    return { ...empty, problem: "storage read failed" };
  }
  if (raw === null) return empty;
  const bytes = raw.length;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...empty, exists: true, bytes, problem: "corrupt JSON" };
  }
  const saved = coerceSavedMatch(parsed);
  if (saved === null) {
    return { ...empty, exists: true, bytes, problem: "invalid/old shape" };
  }
  if (saved.userId !== userId) {
    return { ...empty, exists: true, bytes, problem: "different user" };
  }
  const ageSeconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(saved.savedAt).getTime()) / 1000),
  );
  return {
    exists: true,
    bytes,
    turn: saved.turn,
    savedAt: saved.savedAt,
    ageSeconds,
    problem: null,
  };
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

/** True when a resumable match exists for `userId` (cheap startup check). */
export function hasResumableMatch(store: KeyValueStore, userId: string): boolean {
  return loadActiveMatch(store, userId) !== null;
}

/**
 * Returns a usable localStorage, or null when unavailable/blocked (private mode,
 * SSR, disabled storage). localStorage (not sessionStorage) is used so the
 * recovery record survives a mobile tab being discarded and reloaded as a fresh
 * navigation. The match simply runs without recovery when storage is absent.
 */
export function getRecoveryStore(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage as KeyValueStore | undefined;
    if (!ls) return null;
    const probe = "__euphoria_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
