/**
 * 1v1 Duel (Phase 1: lobby; Phase 2: live match). Create a private invite,
 * share the link, join by code, ready up — and when both players are ready the
 * creator starts the canonical match and BOTH clients mount the Match Arena on
 * the same deterministic game (seed + decks + shared action log; see
 * pvp-match.ts). Ready-up publishes the player's duel deck (their saved custom
 * deck, else the starter deck) on the room row so the creator can start with
 * both decks known.
 *
 * Presentation + the pvp data layer + the pvp match controller — no engine,
 * auth-contract, reward, or AI/local-match code is touched. The arena itself is
 * the existing renderPlayableMatch board: the creator views seat player1
 * directly, the joiner passes `viewerSeat: "player2"` (seat-mirrored). PvP
 * grants NO rewards and writes nothing to match_history.
 */
import type { Card } from "@euphoria/card-data/schema";
import type { Auth, AuthSession } from "@euphoria/core/auth";
import type { StarterFaction } from "@euphoria/core/starter";
import type { MatchSummary } from "@euphoria/core/match";
import { chooseActiveDeck } from "@euphoria/core/deck-builder";
import {
  createPvpClient,
  buildInviteLink,
  bothReady,
  readyColumnFor,
  type PvpClient,
  type PvpDeckPayload,
  type PvpMatch,
  type PvpRoom,
} from "@euphoria/core/pvp";
import { createPvpMatch, type PvpPlayableMatch } from "@euphoria/core/pvp-match";
import { renderPlayableMatch, type PlayableMatchBoard } from "./play-match-view";
import { createCardDetail } from "./detail";

export interface DuelOptions {
  readonly auth: Auth;
  readonly session: AuthSession;
  /** Asset/route base, e.g. "/beta/". */
  readonly base: string;
  /** The full card pool (duel decks are expanded locally against it). */
  readonly pool: readonly Card[];
  /**
   * The player's selected faction (their profile). Needed to resolve the duel
   * deck on ready-up; when null the player is told to pick a starter first.
   */
  readonly faction?: StarterFaction | null;
  /** When set, auto-join this invite code on mount (from an invite link). */
  readonly pendingInvite?: string | null;
  /** Back to the main menu. */
  readonly onExit: () => void;
  /** Injectable PvP client (tests); defaults to the Supabase-backed client. */
  readonly client?: PvpClient | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function mountDuel(container: HTMLElement, options: DuelOptions): void {
  const { session, base, pool, pendingInvite, onExit } = options;
  const faction = options.faction ?? null;
  const client: PvpClient | null =
    options.client !== undefined ? options.client : createPvpClient(session);

  let room: PvpRoom | null = null;
  let unsubscribe: (() => void) | null = null;
  let notice: string | null = null;
  let error: string | null = null;
  let busy = false;
  // Phase 2 (live match) state.
  let startingMatch = false;
  let arenaBoard: PlayableMatchBoard | null = null;
  let arenaController: PvpPlayableMatch | null = null;

  const disposeSub = (): void => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const disposeArena = (): void => {
    if (arenaBoard !== null) {
      arenaBoard.dispose();
      arenaBoard = null;
    }
    if (arenaController !== null) {
      arenaController.dispose();
      arenaController = null;
    }
  };

  const watch = (roomId: string): void => {
    disposeSub();
    if (client === null) return;
    unsubscribe = client.subscribeRoom(roomId, (next) => {
      // Ignore stale rooms for a match we've left, and everything once live.
      if (room !== null && next.id !== room.id) return;
      if (arenaBoard !== null) return;
      const wasAlone = room !== null && room.player_two === null;
      room = next;
      if (wasAlone && next.player_two !== null) notice = "Opponent joined!";
      if (next.status === "abandoned") notice = "The room was closed.";
      // Phase 2: the joiner follows the creator into the arena; the creator
      // fires the match creation exactly once when both players are ready.
      if (next.match_id !== null && next.status === "active") {
        void enterMatch(next.match_id);
        return;
      }
      maybeStartMatch(next);
      render();
    });
  };

  // ---- Phase 2: deck resolution + match start/launch ------------------------

  /**
   * The deck this player brings to a duel: their saved custom deck when it
   * exists and is valid (the same resolution the AI match uses), else the
   * faction's starter deck. Published as jsonb on ready-up.
   */
  const resolveDeckPayload = async (): Promise<PvpDeckPayload> => {
    if (faction === null) {
      throw new Error("Choose your starter deck first (Starter Decks screen), then ready up.");
    }
    let saved = null;
    try {
      saved = await options.auth.getActiveDeck(session, faction);
    } catch {
      saved = null;
    }
    let owned: Awaited<ReturnType<Auth["getOwnedCards"]>> = [];
    try {
      owned = await options.auth.getOwnedCards(session);
    } catch {
      owned = [];
    }
    const chosen = chooseActiveDeck(saved, faction, pool, owned);
    return { faction, entries: chosen.isCustom ? [...chosen.entries] : null };
  };

  /** Creator only: create the canonical match once, when both are ready. */
  const maybeStartMatch = (r: PvpRoom): void => {
    if (client === null || startingMatch) return;
    if (r.created_by !== session.userId) return;
    if (r.status !== "waiting" || r.match_id !== null || !bothReady(r)) return;
    if (r.player_one_deck === null || r.player_two_deck === null) return;
    startingMatch = true;
    render();
    void (async () => {
      try {
        const seed = Math.floor(Math.random() * 0x7fffffff);
        const match = await client.startMatch(r, seed);
        await enterMatch(match.id, match);
      } catch (e) {
        startingMatch = false;
        error = e instanceof Error ? e.message : "Could not start the match.";
        render();
      }
    })();
  };

  /** Both sides: build the controller from the match row and mount the arena. */
  const enterMatch = async (matchId: string, preloaded?: PvpMatch): Promise<void> => {
    if (client === null || arenaBoard !== null) return;
    try {
      const match = preloaded ?? (await client.getMatch(matchId));
      if (match === null) throw new Error("The match could not be loaded.");
      const controller = createPvpMatch({
        match,
        userId: session.userId,
        pool,
        client,
        onSyncError: (message) => showSyncError(message),
      });
      launchArena(controller);
    } catch (e) {
      error = e instanceof Error ? e.message : "The match could not be loaded.";
      startingMatch = false;
      render();
    }
  };

  const launchArena = (controller: PvpPlayableMatch): void => {
    disposeSub(); // the lobby subscription is done; the controller has its own
    arenaController = controller;
    container.replaceChildren();

    const wrap = document.createElement("section");
    wrap.className = "gc-duel gc-duel--arena";
    // Sync problems surface here without tearing the board down.
    const syncBanner = document.createElement("p");
    syncBanner.className = "gc-duel__sync-error";
    syncBanner.hidden = true;
    wrap.append(syncBanner);

    const detail = createCardDetail(base);
    arenaBoard = renderPlayableMatch(
      controller,
      {
        onComplete: (summary) => showResult(summary),
        onQuit: () => {
          // Concede: the opponent wins; then back to the menu. Best-effort —
          // leaving anyway must never trap the player in a dead board.
          void (async () => {
            try {
              await controller.concede();
            } catch {
              /* best-effort */
            }
            cleanup();
            onExit();
          })();
        },
        onInspect: (card) => detail.open(card),
      },
      {
        viewerSeat: controller.mySeat,
        remote: { subscribe: controller.subscribeRemote },
      },
    );
    wrap.append(arenaBoard, detail.element);
    container.append(wrap);
  };

  const showSyncError = (message: string): void => {
    const banner = container.querySelector<HTMLElement>(".gc-duel__sync-error");
    if (banner !== null) {
      banner.textContent = message;
      banner.hidden = false;
    }
  };

  /** The duel result panel. No rewards, no history writes — friendly match. */
  const showResult = (summary: MatchSummary): void => {
    disposeArena();
    container.replaceChildren();
    const el = document.createElement("section");
    el.className = "gc-duel";
    el.innerHTML = `
      <div class="gc-panel gc-duel__result">
        <h2 class="gc-panel__title">${summary.playerWon ? "Victory!" : summary.outcome === "draw" ? "Draw" : "Defeat"}</h2>
        <p class="gc-duel__result-verdict">${esc(
          summary.playerWon
            ? `You defeated ${summary.opponentFaction}.`
            : summary.outcome === "draw"
              ? "The duel ended with no winner."
              : `${summary.opponentFaction} takes the duel.`,
        )}</p>
        <ul class="gc-duel__result-lines">
          ${summary.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}
        </ul>
        <p class="gc-panel__line">Friendly duel — no rewards or record changes.</p>
        <button type="button" class="gc-btn gc-btn--primary" data-act="exit">Back to menu</button>
      </div>`;
    el.querySelector<HTMLButtonElement>('[data-act="exit"]')!.addEventListener("click", () => {
      cleanup();
      onExit();
    });
    container.append(el);
  };

  const cleanup = (): void => {
    disposeArena();
    disposeSub();
    room = null;
  };

  // ---- actions -------------------------------------------------------------
  const createRoom = async (): Promise<void> => {
    if (client === null || busy) return;
    busy = true;
    error = null;
    render();
    try {
      room = await client.createRoom();
      watch(room.id);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not create a room.";
    } finally {
      busy = false;
      render();
    }
  };

  const joinRoom = async (code: string): Promise<void> => {
    if (client === null || busy) return;
    busy = true;
    error = null;
    notice = null;
    render();
    try {
      const res = await client.joinByCode(code);
      if (res.error !== undefined || res.room === undefined) {
        error = friendly(res.error ?? "Could not join that room.");
      } else {
        room = res.room;
        watch(room.id);
        // A rejoin can land in an already-live room (e.g. a reload mid-duel).
        if (room.match_id !== null && room.status === "active") {
          void enterMatch(room.match_id);
        }
      }
    } catch (e) {
      error = e instanceof Error ? friendly(e.message) : "Could not join that room.";
    } finally {
      busy = false;
      if (arenaBoard === null) render();
    }
  };

  const toggleReady = async (): Promise<void> => {
    if (client === null || room === null || busy) return;
    const column = readyColumnFor(room, session.userId);
    if (column === null) return;
    const next = !room[column];
    busy = true;
    error = null;
    render();
    try {
      // Readying up publishes the duel deck; cancelling clears it.
      const deck = next ? await resolveDeckPayload() : undefined;
      room = await client.setReady(room, next, deck);
      // The creator may now be able to start (their own ready was the last).
      maybeStartMatch(room);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not update ready state.";
    } finally {
      busy = false;
      if (arenaBoard === null) render();
    }
  };

  const leave = async (): Promise<void> => {
    if (client !== null && room !== null) {
      try {
        await client.leaveRoom(room);
      } catch {
        /* best-effort */
      }
    }
    cleanup();
    onExit();
  };

  const copyLink = async (): Promise<void> => {
    if (room === null) return;
    const link = buildInviteLink(base, room.room_code);
    try {
      await navigator.clipboard.writeText(link);
      notice = "Invite link copied!";
    } catch {
      notice = "Copy failed — select and copy the link manually.";
    }
    render();
  };

  // ---- rendering -----------------------------------------------------------
  function render(): void {
    if (arenaBoard !== null) return; // the arena owns the container while live
    container.replaceChildren();
    const root = document.createElement("section");
    root.className = "gc-duel";

    if (client === null) {
      root.innerHTML = `
        <div class="gc-panel">
          <h2 class="gc-panel__title">1v1 Duel</h2>
          <p class="gc-panel__line">Private duels need an online account. This build isn't connected to the match service, so duels are unavailable here.</p>
          <button type="button" class="gc-btn" data-act="exit">Back to menu</button>
        </div>`;
      root.querySelector<HTMLButtonElement>('[data-act="exit"]')!.addEventListener("click", onExit);
      container.append(root);
      return;
    }

    root.append(room === null ? renderHome() : renderLobby(room));
    container.append(root);
  }

  function banner(): string {
    const parts: string[] = [];
    if (error !== null) parts.push(`<p class="gc-duel__error" role="alert">${esc(error)}</p>`);
    if (notice !== null) parts.push(`<p class="gc-duel__notice">${esc(notice)}</p>`);
    return parts.join("");
  }

  function renderHome(): HTMLElement {
    const el = document.createElement("div");
    el.className = "gc-panel gc-duel__home";
    el.innerHTML = `
      <h2 class="gc-panel__title">1v1 Duel</h2>
      <p class="gc-panel__line">Play a friendly match against a friend over a private invite link.</p>
      ${banner()}
      <button type="button" class="gc-btn gc-btn--primary" data-act="create" ${busy ? "disabled" : ""}>
        ${busy ? "Creating…" : "Create Invite"}
      </button>
      <div class="gc-duel__join">
        <label class="gc-duel__label" for="gc-duel-code">Have a code?</label>
        <div class="gc-duel__join-row">
          <input id="gc-duel-code" class="gc-duel__input" type="text" inputmode="latin"
                 autocomplete="off" spellcheck="false" placeholder="invite code" maxlength="16" />
          <button type="button" class="gc-btn" data-act="join" ${busy ? "disabled" : ""}>Join</button>
        </div>
      </div>
      <button type="button" class="gc-link" data-act="exit">Back to menu</button>
    `;
    el.querySelector<HTMLButtonElement>('[data-act="create"]')!.addEventListener("click", () => void createRoom());
    const input = el.querySelector<HTMLInputElement>("#gc-duel-code")!;
    const doJoin = (): void => {
      const code = input.value.trim().toLowerCase();
      if (code !== "") void joinRoom(code);
    };
    el.querySelector<HTMLButtonElement>('[data-act="join"]')!.addEventListener("click", doJoin);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJoin();
    });
    el.querySelector<HTMLButtonElement>('[data-act="exit"]')!.addEventListener("click", onExit);
    return el;
  }

  function renderLobby(r: PvpRoom): HTMLElement {
    const el = document.createElement("div");
    el.className = "gc-panel gc-duel__lobby";
    const link = buildInviteLink(base, r.room_code);
    const myColumn = readyColumnFor(r, session.userId);
    const iAmReady = myColumn !== null && r[myColumn];
    const oppFilled = r.player_two !== null;
    const ready = bothReady(r);

    const seatRow = (label: string, filled: boolean, isReady: boolean, you: boolean): string =>
      `<li class="gc-duel__seat ${filled ? "is-filled" : "is-empty"}">
        <span class="gc-duel__seat-name">${esc(label)}${you ? " (you)" : ""}</span>
        <span class="gc-duel__seat-state">${
          !filled ? "waiting…" : isReady ? "✓ ready" : "not ready"
        }</span>
      </li>`;

    el.innerHTML = `
      <h2 class="gc-panel__title">Duel Lobby</h2>
      ${banner()}
      <div class="gc-duel__code">
        <span class="gc-duel__code-label">Invite code</span>
        <code class="gc-duel__code-value">${esc(r.room_code)}</code>
        <button type="button" class="gc-btn gc-btn--small" data-act="copy">Copy link</button>
      </div>
      <input class="gc-duel__link" type="text" readonly value="${esc(link)}" aria-label="Invite link" />
      <ul class="gc-duel__seats">
        ${seatRow(
          "Player 1",
          true,
          r.player_one_ready,
          r.player_one === session.userId,
        )}
        ${seatRow(
          "Player 2",
          oppFilled,
          r.player_two_ready,
          r.player_two === session.userId,
        )}
      </ul>
      ${
        ready || startingMatch
          ? `<p class="gc-duel__go">Both players ready — starting the duel…</p>`
          : `<button type="button" class="gc-btn gc-btn--primary" data-act="ready" ${
              busy ? "disabled" : ""
            }>${iAmReady ? "Cancel ready" : "Ready up"}</button>
             ${oppFilled ? "" : '<p class="gc-panel__line">Share the invite link so your opponent can join.</p>'}`
      }
      <button type="button" class="gc-link" data-act="leave">Leave room</button>
    `;
    el.querySelector<HTMLButtonElement>('[data-act="copy"]')!.addEventListener("click", () => void copyLink());
    el.querySelector<HTMLInputElement>(".gc-duel__link")!.addEventListener("focus", (e) => {
      (e.target as HTMLInputElement).select();
    });
    el.querySelector<HTMLButtonElement>('[data-act="ready"]')?.addEventListener("click", () => void toggleReady());
    el.querySelector<HTMLButtonElement>('[data-act="leave"]')!.addEventListener("click", () => void leave());
    return el;
  }

  // Translate raw RPC/DB messages into friendly copy.
  function friendly(message: string): string {
    const m = message.toLowerCase();
    if (m.includes("not found")) return "That invite is invalid or was already used.";
    if (m.includes("expired")) return "This invite has expired — ask for a fresh link.";
    if (m.includes("own room")) return "That's your own invite. Share the link with a friend.";
    if (m.includes("full")) return "This room is already full.";
    if (m.includes("not open")) return "This match has already started or ended.";
    return message;
  }

  // ---- boot ----------------------------------------------------------------
  render();
  if (pendingInvite !== null && pendingInvite !== undefined && client !== null) {
    void joinRoom(pendingInvite);
  }
}
