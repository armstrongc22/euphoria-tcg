/**
 * Seat mirroring for PvP (Phase 2). PURE: no DOM, no network, no engine calls.
 *
 * A PvP duel is ONE canonical game (room creator = player1, joiner = player2)
 * synced as `seed + decks + ordered action log`. The Match Arena view and the
 * protected playback helpers (match-playback.ts) render seat `player1` as "You"
 * — correct for the creator, inverted for the joiner. Rather than touching the
 * ENGINE_LOCK-protected playback code, the joiner's client mirrors the world at
 * the presentation boundary: every exact `"player1"`/`"player2"` string value
 * (and record key) in the plain-data engine state/events/actions is swapped, so
 * the joiner sees themself as `player1` while the canonical game and its action
 * log stay untouched underneath.
 *
 * Safe because engine state is plain JSON-ish data (verified: `rngState` is a
 * number; instance ids are `warrior-N`, never exactly a seat literal) and the
 * swap is an involution (applying it twice restores the original), so actions
 * from a mirrored view can be un-mirrored with the same function.
 */
import type { PlayerId } from "@euphoria/game-engine";
import type { ApplyResult, PlayableMatch } from "@euphoria/core/play-match";

/** The two canonical seats. */
const SEAT_ONE: PlayerId = "player1";
const SEAT_TWO: PlayerId = "player2";

/** Swaps one string if it is exactly a seat literal; otherwise returns it as-is. */
function swapString(value: string): string {
  if (value === SEAT_ONE) return SEAT_TWO;
  if (value === SEAT_TWO) return SEAT_ONE;
  return value;
}

/**
 * Deep-copies `value`, swapping every string value AND object key that is
 * exactly `"player1"`/`"player2"`. Arrays and plain objects are rebuilt;
 * primitives (and anything non-plain, defensively) pass through untouched.
 * The result is typed as the input: mirroring a GameState yields a GameState.
 */
export function swapSeats<T>(value: T): T {
  if (typeof value === "string") {
    return swapString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => swapSeats(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[swapString(key)] = swapSeats(val);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Wraps a {@link PlayableMatch} so all engine-shaped data crossing the boundary
 * is seat-mirrored: `state()`, `legalActions()`, `history()` and the frames
 * returned by `apply()` come out mirrored, and actions passed INTO `apply()`
 * are un-mirrored back to canonical seats first. Viewer-relative fields —
 * `playerFaction`, `opponentFaction`, `isOver()`, `summary()` — pass through
 * unchanged (the PvP controller already produces those from the viewer's
 * perspective). The AI/local match flow never uses this wrapper.
 */
export function mirrorPlayableMatch(match: PlayableMatch): PlayableMatch {
  return {
    playerFaction: match.playerFaction,
    opponentFaction: match.opponentFaction,
    seed: match.seed,
    state: () => swapSeats(match.state()),
    isOver: () => match.isOver(),
    legalActions: () => swapSeats(match.legalActions()),
    apply: (action): ApplyResult => {
      const result = match.apply(swapSeats(action));
      if (!result.ok) return result;
      return { ok: true, frames: swapSeats(result.frames) };
    },
    history: () => swapSeats(match.history()),
    summary: () => match.summary(),
  };
}
