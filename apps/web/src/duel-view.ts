/**
 * 1v1 Duel lobby (Phase 1). Create a private invite, share the link, join by
 * code, see the waiting room, and both players ready up. The live match itself
 * (deterministic action-log sync) arrives in Phase 2 — when both players are
 * ready this screen surfaces a clearly-labelled "coming next" state rather than
 * launching a match, so nothing half-wired ships.
 *
 * Presentation only + the new pvp data layer — no engine, auth, reward, or
 * AI/local-match code is touched.
 */
import type { Auth, AuthSession } from "@euphoria/core/auth";
import {
  createPvpClient,
  buildInviteLink,
  bothReady,
  readyColumnFor,
  type PvpClient,
  type PvpRoom,
} from "@euphoria/core/pvp";

export interface DuelOptions {
  readonly auth: Auth;
  readonly session: AuthSession;
  /** Asset/route base, e.g. "/beta/". */
  readonly base: string;
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
  const { session, base, pendingInvite, onExit } = options;
  const client: PvpClient | null =
    options.client !== undefined ? options.client : createPvpClient(session);

  let room: PvpRoom | null = null;
  let unsubscribe: (() => void) | null = null;
  let notice: string | null = null;
  let error: string | null = null;
  let busy = false;

  const disposeSub = (): void => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const watch = (roomId: string): void => {
    disposeSub();
    if (client === null) return;
    unsubscribe = client.subscribeRoom(roomId, (next) => {
      // Ignore stale rooms for a match we've left.
      if (room !== null && next.id !== room.id) return;
      const wasAlone = room !== null && room.player_two === null;
      room = next;
      if (wasAlone && next.player_two !== null) notice = "Opponent joined!";
      if (next.status === "abandoned") notice = "The room was closed.";
      render();
    });
  };

  const meIsCreator = (): boolean => room !== null && room.created_by === session.userId;

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
      }
    } catch (e) {
      error = e instanceof Error ? friendly(e.message) : "Could not join that room.";
    } finally {
      busy = false;
      render();
    }
  };

  const toggleReady = async (): Promise<void> => {
    if (client === null || room === null || busy) return;
    const column = readyColumnFor(room, session.userId);
    if (column === null) return;
    const next = !room[column];
    busy = true;
    render();
    try {
      room = await client.setReady(room, next);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not update ready state.";
    } finally {
      busy = false;
      render();
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
    disposeSub();
    room = null;
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
        ready
          ? `<p class="gc-duel__go">Both players ready! Live duels start in the next update.</p>
             <button type="button" class="gc-btn gc-btn--primary" disabled>Start Match (coming soon)</button>`
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
