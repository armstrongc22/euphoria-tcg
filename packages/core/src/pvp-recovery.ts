/**
 * PvP crash/refresh recovery pointer. PURE logic + an injected KeyValueStore,
 * mirroring match-recovery.ts (which is ENGINE_LOCK-protected and untouched).
 *
 * Unlike a solo match, a PvP duel's canonical state lives in Supabase
 * (`pvp_matches`: seed + decks + shared action log), so nothing heavy is
 * persisted here — just a lightweight pointer (match id + room id) naming the
 * duel this device was last in. On return, the duel view verifies the pointer
 * against Supabase before offering recovery:
 *
 *  - row still `active`  → "Continue / Concede" prompt;
 *  - row completed/abandoned while away → show the result, clear the pointer;
 *  - row missing → clear the pointer silently.
 *
 * The pointer is the only way to notice a duel that ENDED while the player was
 * gone (an active-matches query no longer returns it). It is cleared when a
 * duel resolves (result shown or concede) — never on plain navigation, so a
 * player who wanders off mid-duel is still offered the way back.
 */
import type { KeyValueStore } from "@euphoria/core/signup";

/** localStorage key. Versioned so the shape can change without clashing. */
export const PVP_POINTER_KEY = "euphoria.pvpMatchPointer.v1";

/** Bumped when {@link PvpMatchPointer}'s shape changes. */
export const PVP_POINTER_VERSION = 1;

/** Names the duel this device was last playing. Verified before every use. */
export interface PvpMatchPointer {
  readonly version: number;
  /** Scopes the pointer to the signed-in user (no cross-account recovery). */
  readonly userId: string;
  readonly matchId: string;
  readonly roomId: string;
  readonly savedAt: string;
}

/** The fields a caller supplies; version/savedAt are stamped here. */
export type PvpMatchPointerInput = Omit<PvpMatchPointer, "version" | "savedAt">;

/** Narrows an unknown parsed value to a current-version pointer, or null. */
export function coercePvpPointer(value: unknown): PvpMatchPointer | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v["version"] !== PVP_POINTER_VERSION) return null;
  if (typeof v["userId"] !== "string" || v["userId"].length === 0) return null;
  if (typeof v["matchId"] !== "string" || v["matchId"].length === 0) return null;
  if (typeof v["roomId"] !== "string") return null;
  if (typeof v["savedAt"] !== "string") return null;
  return {
    version: PVP_POINTER_VERSION,
    userId: v["userId"],
    matchId: v["matchId"],
    roomId: v["roomId"],
    savedAt: v["savedAt"],
  };
}

/** Persists the pointer (best-effort; never throws). */
export function savePvpPointer(
  store: KeyValueStore,
  input: PvpMatchPointerInput,
  now: Date = new Date(),
): boolean {
  const record: PvpMatchPointer = {
    ...input,
    version: PVP_POINTER_VERSION,
    savedAt: now.toISOString(),
  };
  try {
    store.setItem(PVP_POINTER_KEY, JSON.stringify(record));
    return true;
  } catch {
    // Storage full/blocked — recovery is best-effort and must never break the
    // duel itself.
    return false;
  }
}

/** Loads the pointer for `userId`, or null if absent/corrupt/another user's. */
export function loadPvpPointer(
  store: KeyValueStore,
  userId: string,
): PvpMatchPointer | null {
  let raw: string | null;
  try {
    raw = store.getItem(PVP_POINTER_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const pointer = coercePvpPointer(parsed);
  if (pointer === null || pointer.userId !== userId) return null;
  return pointer;
}

/** Removes the pointer (call when a duel resolves: result shown or conceded). */
export function clearPvpPointer(store: KeyValueStore): void {
  try {
    store.removeItem(PVP_POINTER_KEY);
  } catch {
    /* best-effort */
  }
}
