/**
 * PvP live-match controller (Phase 2). PURE of DOM; network only through the
 * injected {@link PvpClient}.
 *
 * Implements the existing {@link PlayableMatch} interface over ONE canonical
 * deterministic game — creator = seat player1, joiner = player2 — so the Match
 * Arena view renders a duel exactly like an AI match. Where the AI controller
 * (play-match.ts, ENGINE_LOCK-protected and untouched) runs `smartAgent` for
 * player2, this controller:
 *
 *  - applies the local player's actions to the canonical engine state and
 *    appends them to the shared `action_log` in `pvp_matches` (optimistic
 *    `version` guard; pushes are serialized and retried);
 *  - receives the opponent's actions from the subscription, applies the log
 *    tail it hasn't seen, and emits them as {@link MatchFrame}s (actor
 *    "opponent") for the view's normal step-by-step playback;
 *  - never re-derives legality — `getLegalActions` / `applyAction` on the
 *    canonical state stay the single source of truth, and it is only ever the
 *    viewer's move when `state.activePlayer === mySeat`.
 *
 * The controller always exposes CANONICAL state/frames; a player2 viewer is
 * mirrored at the presentation boundary (see seat-mirror.ts / the view's
 * `viewerSeat` option). `summary()` alone is viewer-relative, so the result
 * screen reads correctly for both players. PvP grants NO rewards.
 */
import type { Card } from "@euphoria/card-data/schema";
import {
  applyAction,
  createGame,
  getLegalActions,
  type GameAction,
  type GameState,
} from "@euphoria/game-engine";
import { buildGameResult, type EndReason } from "@euphoria/simulator";
import { expandStarterDeck, summarizeMatch, type MatchSummary } from "@euphoria/core/match";
import { expandDeckEntries } from "@euphoria/core/deck-builder";
import type { StarterFaction } from "@euphoria/core/starter";
import type { ApplyResult, MatchFrame, PlayableMatch } from "@euphoria/core/play-match";
import { swapSeats } from "@euphoria/core/seat-mirror";
import {
  coerceDeckPayload,
  seatOf,
  uidAtSeat,
  type PvpClient,
  type PvpMatch,
} from "@euphoria/core/pvp";

/** A canonical engine seat. */
export type Seat = "player1" | "player2";

/** Options for {@link createPvpMatch}. */
export interface PvpMatchOptions {
  /** The match row (fresh from startMatch/getMatch). */
  readonly match: PvpMatch;
  /** The signed-in user — decides which seat is "you". */
  readonly userId: string;
  /** The full card pool (decks are expanded locally against it). */
  readonly pool: readonly Card[];
  /** The PvP data-layer client (injectable in tests). */
  readonly client: PvpClient;
  /**
   * Surfaced when syncing breaks: a push that keeps failing, or a shared log
   * that no longer matches ours. The duel view shows it; the board stays up.
   */
  readonly onSyncError?: (message: string) => void;
  /** Delay between push retries (ms); tests pass 0. Default 800. */
  readonly retryDelayMs?: number;
}

/** A live duel: the arena-compatible match plus its sync surface. */
export interface PvpPlayableMatch extends PlayableMatch {
  /** Which canonical seat the local player occupies. */
  readonly mySeat: Seat;
  /**
   * Subscribes to remote changes. Non-empty frames are the opponent's actions
   * in order (for playback); an EMPTY array means "state changed without new
   * actions" (e.g. the opponent conceded) — repaint and re-check isOver().
   */
  subscribeRemote(cb: (frames: MatchFrame[]) => void): () => void;
  /** Concedes the duel: the opponent wins, the match row is closed. */
  concede(): Promise<void>;
  /** Stops the subscription and all further pushes/emits. Idempotent. */
  dispose(): void;
}

const PUSH_ATTEMPTS = 3;

/** Thrown when the match row can't seat this user or its data is unusable. */
export class PvpMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PvpMatchError";
  }
}

function expandDeck(
  payload: PvpMatch["player_one_deck"],
  which: string,
  pool: readonly Card[],
): { faction: StarterFaction; cards: Card[] } {
  const deck = coerceDeckPayload(payload);
  if (deck === null) {
    throw new PvpMatchError(`The ${which} deck for this duel is missing or invalid.`);
  }
  const cards =
    deck.entries !== null
      ? expandDeckEntries(deck.entries, pool)
      : expandStarterDeck(deck.faction, pool);
  return { faction: deck.faction, cards };
}

/**
 * Builds the canonical game from the match row (seed + both decks), replays the
 * shared action log, and returns the live controller. Throws {@link PvpMatchError}
 * if the user isn't seated, a deck is unusable, or the log doesn't replay —
 * the duel view surfaces that instead of mounting a corrupt board.
 */
export function createPvpMatch(options: PvpMatchOptions): PvpPlayableMatch {
  const { match, userId, pool, client } = options;
  const retryDelayMs = options.retryDelayMs ?? 800;

  const mySeat = seatOf(match, userId);
  if (mySeat === null) throw new PvpMatchError("You are not a player in this match.");
  const theirSeat: Seat = mySeat === "player1" ? "player2" : "player1";

  const one = expandDeck(match.player_one_deck, "creator's", pool);
  const two = expandDeck(match.player_two_deck, "joiner's", pool);
  const myFaction = mySeat === "player1" ? one.faction : two.faction;
  const theirFaction = mySeat === "player1" ? two.faction : one.faction;

  let state: GameState = createGame({
    decks: { player1: one.cards, player2: two.cards },
    seed: match.seed,
  });

  // The shared log we have applied, and the row version it corresponds to.
  const log: GameAction[] = [];
  let version = match.version;
  let rowStatus = match.status;
  let rowWinner = match.winner;
  let disposed = false;
  // Set when the shared log stops matching ours — the board freezes (no legal
  // actions) rather than letting the two clients diverge silently.
  let diverged = false;

  const applyToState = (action: GameAction): MatchFrame | string => {
    const before = state.events.length;
    const result = applyAction(state, action);
    if (!result.ok) return result.error.message;
    state = result.state;
    log.push(action);
    // `actor` is provisional — every caller re-stamps it for its own side.
    return { state, events: state.events.slice(before), actor: "player" };
  };

  // Fast-forward the existing log (a reload or a joiner mounting mid-game).
  for (const action of match.action_log) {
    const frame = applyToState(action);
    if (typeof frame === "string") {
      throw new PvpMatchError(`This duel could not be restored: ${frame}`);
    }
  }

  // ---- remote emission ------------------------------------------------------
  const remoteSubscribers = new Set<(frames: MatchFrame[]) => void>();
  // Frames that arrived before anyone subscribed (mount races the first poll).
  let buffered: MatchFrame[] = [];

  const emitRemote = (frames: MatchFrame[]): void => {
    if (disposed) return;
    if (remoteSubscribers.size === 0) {
      buffered = buffered.concat(frames);
      return;
    }
    for (const cb of remoteSubscribers) cb(frames);
  };

  const isOver = (): boolean =>
    state.winner !== null || rowStatus !== "active" || diverged;

  // ---- incoming rows ---------------------------------------------------------
  const onRow = (row: PvpMatch): void => {
    if (disposed || diverged) return;
    if (row.version <= version && row.status === rowStatus) return; // stale echo
    // Guard divergence: the shared log must extend what we've applied.
    if (row.action_log.length < log.length) return; // older write; version race
    const statusChanged = row.status !== rowStatus;
    const frames: MatchFrame[] = [];
    for (let i = log.length; i < row.action_log.length; i += 1) {
      const action = row.action_log[i]!;
      const frame = applyToState(action);
      if (typeof frame === "string") {
        diverged = true;
        options.onSyncError?.(
          `The duel went out of sync and was frozen (${frame}). Please start a new match.`,
        );
        emitRemote([]);
        return;
      }
      frames.push({ ...frame, actor: "opponent" });
    }
    version = Math.max(version, row.version);
    rowStatus = row.status;
    rowWinner = row.winner;
    if (frames.length > 0 || statusChanged) {
      emitRemote(frames);
    }
  };

  const unsubscribe = client.subscribeMatch(match.id, onRow);

  // ---- outgoing pushes --------------------------------------------------------
  // Pushes are serialized: each waits for the previous, so version chaining is
  // race-free on our side (only the active player writes during their turn).
  let pushChain: Promise<void> = Promise.resolve();

  const buildPatch = (over: {
    status?: PvpMatch["status"];
    winner?: string | null;
  }): Parameters<PvpClient["pushMatch"]>[2] => ({
    action_log: [...log],
    current_player:
      state.winner !== null ? null : uidAtSeat(match, state.activePlayer as Seat),
    ...(state.winner !== null
      ? { status: "completed" as const, winner: uidAtSeat(match, state.winner as Seat) }
      : {}),
    ...over,
  });

  const doPush = async (patch: Parameters<PvpClient["pushMatch"]>[2]): Promise<void> => {
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
      if (disposed) return;
      try {
        const res = await client.pushMatch(match.id, version, patch);
        if (res.ok) {
          version = res.match.version;
          rowStatus = res.match.status;
          rowWinner = res.match.winner;
          return;
        }
        if (res.conflict) {
          // The only legitimate concurrent write is the opponent closing the
          // match (concede/abandon) — adopt it; otherwise surface the failure.
          const fresh = await client.getMatch(match.id);
          if (fresh !== null) {
            version = Math.max(version, fresh.version);
            if (fresh.status !== "active" && fresh.action_log.length <= log.length) {
              rowStatus = fresh.status;
              rowWinner = fresh.winner;
              emitRemote([]);
              return;
            }
            onRow(fresh);
          }
          options.onSyncError?.("Your move could not be saved — the match changed underneath it.");
          return;
        }
        // Transient failure: retry.
        if (attempt === PUSH_ATTEMPTS) {
          options.onSyncError?.(`Could not reach the match service: ${res.message}`);
          return;
        }
      } catch (error) {
        if (attempt === PUSH_ATTEMPTS) {
          const message = error instanceof Error ? error.message : String(error);
          options.onSyncError?.(`Could not reach the match service: ${message}`);
          return;
        }
      }
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  };

  const enqueuePush = (over: { status?: PvpMatch["status"]; winner?: string | null } = {}): Promise<void> => {
    const next = pushChain.then(() => doPush(buildPatch(over)));
    pushChain = next.catch(() => {});
    return next;
  };

  // ---- the PlayableMatch surface ----------------------------------------------
  const apply = (action: GameAction): ApplyResult => {
    if (isOver()) return { ok: false, message: "The match is already over." };
    if (state.activePlayer !== mySeat) {
      return { ok: false, message: "It is not your turn." };
    }
    const frame = applyToState(action);
    if (typeof frame === "string") return { ok: false, message: frame };
    void enqueuePush();
    return { ok: true, frames: [{ ...frame, actor: "player" }] };
  };

  const summary = (): MatchSummary => {
    // Viewer-relative: mirror the canonical state for a player2 viewer so the
    // shared summarizeMatch (which reads seat player1 as "you") stays correct.
    const viewerState = mySeat === "player2" ? swapSeats(state) : state;
    const reason: EndReason = state.winner !== null ? "win" : "noLegalActions";
    const base = summarizeMatch(
      myFaction,
      theirFaction,
      buildGameResult(viewerState, { reason, actions: log.length }),
      match.seed,
    );
    if (state.winner === null && rowStatus === "abandoned") {
      // Concede: the engine has no winner — the row does. Rewrite the verdict.
      const playerWon = rowWinner === userId;
      return {
        ...base,
        outcome: playerWon ? "win" : "loss",
        playerWon,
        winnerLabel: playerWon ? "You" : theirFaction,
        highlights: [
          playerWon
            ? "Your opponent conceded the duel."
            : "You conceded the duel.",
          ...base.highlights.slice(1),
        ],
      };
    }
    return base;
  };

  return {
    playerFaction: myFaction,
    opponentFaction: theirFaction,
    seed: match.seed,
    mySeat,
    state: () => state,
    isOver,
    legalActions: () =>
      !isOver() && state.activePlayer === mySeat ? getLegalActions(state) : [],
    apply,
    history: () => [...log],
    summary,
    subscribeRemote: (cb) => {
      remoteSubscribers.add(cb);
      if (buffered.length > 0) {
        const flush = buffered;
        buffered = [];
        cb(flush);
      }
      return () => remoteSubscribers.delete(cb);
    },
    concede: async () => {
      if (isOver()) return;
      rowStatus = "abandoned";
      rowWinner = uidAtSeat(match, theirSeat);
      await enqueuePush({ status: "abandoned", winner: rowWinner });
    },
    dispose: () => {
      disposed = true;
      remoteSubscribers.clear();
      unsubscribe();
    },
  };
}
