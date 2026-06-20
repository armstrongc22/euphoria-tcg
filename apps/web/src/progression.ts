/**
 * Progression reset orchestration for a confirmed starter-deck switch.
 *
 * A reset must wipe EVERYTHING tied to the account's beta progress, which lives
 * in two places: the backend rows (owned_cards / reward_events / match_history /
 * active_decks, cleared via auth.resetProgression) and local-only state the
 * backend doesn't own — the resume-match snapshot and the pending reward-claim
 * queue. Centralised here so the set of things cleared can't drift between the
 * starter-switch caller and any future one, and so it's unit-testable.
 */
import type { Auth, AuthSession } from "./auth";
import { clearActiveMatch } from "./match-recovery";
import { clearPendingClaims } from "./pending-reward";
import type { KeyValueStore } from "./signup";

/** The local stores a reset must also clear (null when storage is unavailable). */
export interface ProgressionStores {
  /** Resume-match snapshot store (localStorage). */
  readonly recovery: KeyValueStore | null;
  /** Pending reward-claim queue store (localStorage). */
  readonly pending: KeyValueStore | null;
}

/**
 * Wipes all beta progression for `session`'s user: backend rows first (best
 * effort — a failure is swallowed since the account reloads its now-empty data
 * either way), then the resume snapshot and the user's pending reward queue,
 * which are always cleared even if the backend call fails. The faction change
 * itself is the caller's responsibility (auth.saveFaction).
 */
export async function resetAllProgression(
  auth: Auth,
  session: AuthSession,
  stores: ProgressionStores,
): Promise<void> {
  try {
    await auth.resetProgression(session);
  } catch {
    /* best-effort: the local stores below are still cleared */
  }
  if (stores.recovery !== null) clearActiveMatch(stores.recovery);
  if (stores.pending !== null) clearPendingClaims(stores.pending, session.userId);
}
