/**
 * Hidden "notation mode" unlock for the Euphoria map. Normal visitors never see
 * the editor; it's revealed by a secret gesture (tapping the corner compass
 * emblem 5× within a short window). Kept framework-free so the click-window
 * logic is unit-testable, and deliberately separate from marker storage so the
 * unlock state can live in sessionStorage while markers stay in localStorage.
 */

/** Session-only flag — clears when the browser session ends (never localStorage). */
export const NOTATION_KEY = "euphoria_map_notation";

/** Taps required, and the rolling window they must land within. */
export const UNLOCK_TAPS = 5;
export const UNLOCK_WINDOW_MS = 4000;

export interface TapState {
  readonly count: number;
  /** Timestamp of the first tap in the current window. */
  readonly firstAt: number;
}

/**
 * Fold one tap into the running counter. A tap outside the window (or the very
 * first tap) restarts the count at 1; otherwise it increments. Pure — the caller
 * owns the state and decides what to do when {@link isUnlockReached} is true.
 */
export function registerTap(
  state: TapState | null,
  now: number,
  windowMs: number = UNLOCK_WINDOW_MS,
): TapState {
  if (state === null || now - state.firstAt > windowMs) {
    return { count: 1, firstAt: now };
  }
  return { count: state.count + 1, firstAt: state.firstAt };
}

/** True once enough taps have accumulated inside the window. */
export function isUnlockReached(
  state: TapState,
  taps: number = UNLOCK_TAPS,
): boolean {
  return state.count >= taps;
}

/** Read the persisted unlock flag (sessionStorage only). */
export function readNotationUnlocked(): boolean {
  try {
    return sessionStorage.getItem(NOTATION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist (or clear) the unlock flag in sessionStorage. */
export function writeNotationUnlocked(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(NOTATION_KEY, "1");
    else sessionStorage.removeItem(NOTATION_KEY);
  } catch {
    /* storage disabled — notation mode just won't persist across reloads */
  }
}
