/**
 * @vitest-environment jsdom
 *
 * 1v1 Duel view tests with an injected fake PvP client — no Supabase or reward
 * code involved. Phase 1 covers the lobby; Phase 2 covers ready-up deck
 * publishing, the creator starting the canonical match, and both clients
 * mounting the live arena.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cards } from "@euphoria/core/cards";
import { mountDuel } from "../src/duel-view";
import type { PvpClient, PvpMatch, PvpRoom } from "@euphoria/core/pvp";
import {
  PVP_POINTER_KEY,
  PVP_POINTER_VERSION,
  loadPvpPointer,
  savePvpPointer,
} from "@euphoria/core/pvp-recovery";

const A = "user-a";
const B = "user-b";
const sessionA = { userId: A, email: "a@x.dev" };
const sessionB = { userId: B, email: "b@x.dev" };
// Deck/owned lookups fail on the bare stub and degrade to the starter deck —
// exactly the resolution path we want under test.
const auth = {} as never;

function room(over: Partial<PvpRoom> = {}): PvpRoom {
  return {
    id: "room-1",
    room_code: "abcd2345",
    created_by: A,
    player_one: A,
    player_two: null,
    player_one_ready: false,
    player_two_ready: false,
    player_one_deck: null,
    player_two_deck: null,
    status: "waiting",
    match_id: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

function matchRow(over: Partial<PvpMatch> = {}): PvpMatch {
  return {
    id: "match-1",
    room_id: "room-1",
    player_one: A,
    player_two: B,
    seed: 5,
    player_one_deck: { faction: "Sonic", entries: null },
    player_two_deck: { faction: "Dwarf", entries: null },
    current_player: A,
    status: "active",
    action_log: [],
    version: 0,
    winner: null,
    ...over,
  };
}

/** Fake client that records calls and lets a test push room updates. */
function fakeClient(over: Partial<PvpClient> = {}): PvpClient & {
  push: (r: PvpRoom) => void;
} {
  let onChange: ((r: PvpRoom) => void) | null = null;
  return {
    createRoom: vi.fn().mockResolvedValue(room()),
    joinByCode: vi.fn().mockResolvedValue({ room: room({ player_two: B }) }),
    getRoom: vi.fn().mockResolvedValue(room()),
    setReady: vi.fn().mockImplementation((r: PvpRoom, ready: boolean) =>
      Promise.resolve({ ...r, player_one_ready: ready }),
    ),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    subscribeRoom: vi.fn().mockImplementation((_id: string, cb: (r: PvpRoom) => void) => {
      onChange = cb;
      return () => {
        onChange = null;
      };
    }),
    startMatch: vi.fn().mockResolvedValue(matchRow()),
    getMatch: vi.fn().mockResolvedValue(matchRow()),
    listMyActiveMatches: vi.fn().mockResolvedValue([]),
    pushMatch: vi
      .fn()
      .mockImplementation((_id: string, v: number, patch: object) =>
        Promise.resolve({ ok: true, match: { ...matchRow(), ...patch, version: v + 1 } }),
      ),
    subscribeMatch: vi.fn().mockImplementation(() => () => {}),
    push: (r: PvpRoom) => onChange?.(r),
    ...over,
  } as PvpClient & { push: (r: PvpRoom) => void };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mount = (
  root: HTMLElement,
  overrides: Partial<Parameters<typeof mountDuel>[1]> = {},
): void =>
  mountDuel(root, {
    auth,
    session: sessionA,
    base: "/beta/",
    pool: cards,
    faction: "Sonic",
    onExit: () => {},
    client: fakeClient(),
    ...overrides,
  });

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom's localStorage is shared across tests — drop any recovery pointer.
  localStorage.clear();
});

describe("mountDuel — lobby (Phase 1)", () => {
  it("shows the unavailable panel when there is no PvP client", () => {
    const root = document.createElement("div");
    mount(root, { client: null });
    expect(root.textContent).toContain("duels are unavailable");
  });

  it("renders Create Invite and a join field on the home screen", () => {
    const root = document.createElement("div");
    mount(root);
    expect(root.querySelector('[data-act="create"]')).not.toBeNull();
    expect(root.querySelector("#gc-duel-code")).not.toBeNull();
    expect(root.querySelector('[data-act="join"]')).not.toBeNull();
  });

  it("creates a room and shows the code + invite link", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    expect(client.createRoom).toHaveBeenCalled();
    expect(root.querySelector(".gc-duel__code-value")!.textContent).toBe("abcd2345");
    expect(root.querySelector<HTMLInputElement>(".gc-duel__link")!.value).toContain("?invite=abcd2345");
  });

  it("auto-joins from a pending invite link", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { session: sessionB, pendingInvite: "abcd2345", client });
    await flush();
    expect(client.joinByCode).toHaveBeenCalledWith("abcd2345");
    expect(root.querySelector(".gc-duel__lobby")).not.toBeNull();
  });

  it("shows a friendly error when joining a full room", async () => {
    const root = document.createElement("div");
    const client = fakeClient({ joinByCode: vi.fn().mockResolvedValue({ error: "room full" }) });
    mount(root, { session: sessionB, client });
    root.querySelector<HTMLInputElement>("#gc-duel-code")!.value = "abcd2345";
    root.querySelector<HTMLButtonElement>('[data-act="join"]')!.click();
    await flush();
    expect(root.querySelector(".gc-duel__error")!.textContent!.toLowerCase()).toContain("full");
  });

  it("leaves the room and calls onExit", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    const onExit = vi.fn();
    mount(root, { client, onExit });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-act="leave"]')!.click();
    await flush();
    expect(client.leaveRoom).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });
});

describe("mountDuel — live match (Phase 2)", () => {
  it("publishes the duel deck (starter fallback) on ready-up", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    client.push(room({ player_two: B }));
    root.querySelector<HTMLButtonElement>('[data-act="ready"]')!.click();
    await flush();
    expect(client.setReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: "room-1" }),
      true,
      { faction: "Sonic", entries: null },
    );
  });

  it("refuses to ready up without a selected faction", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { client, faction: null });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    client.push(room({ player_two: B }));
    root.querySelector<HTMLButtonElement>('[data-act="ready"]')!.click();
    await flush();
    expect(client.setReady).not.toHaveBeenCalled();
    expect(root.querySelector(".gc-duel__error")!.textContent).toContain("starter deck");
  });

  it("creator starts the match and mounts the arena when both are ready", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    client.push(
      room({
        player_two: B,
        player_one_ready: true,
        player_two_ready: true,
        player_one_deck: { faction: "Sonic", entries: null },
        player_two_deck: { faction: "Dwarf", entries: null },
      }),
    );
    await flush();
    expect(client.startMatch).toHaveBeenCalledTimes(1);
    // The live board mounted, creator POV: their faction accent, their move.
    const board = root.querySelector<HTMLElement>(".play-match")!;
    expect(board).not.toBeNull();
    expect(board.dataset["faction"]).toBe("Sonic");
    expect(board.querySelector(".play-match__phase-state")!.textContent).toBe("Your move");
    expect(client.subscribeMatch).toHaveBeenCalled();
  });

  it("does not start the match twice on repeated room updates", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    const ready = room({
      player_two: B,
      player_one_ready: true,
      player_two_ready: true,
      player_one_deck: { faction: "Sonic", entries: null },
      player_two_deck: { faction: "Dwarf", entries: null },
    });
    client.push(ready);
    client.push(ready);
    await flush();
    expect(client.startMatch).toHaveBeenCalledTimes(1);
  });

  it("joiner follows into the arena when the room goes active, seat-mirrored", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mount(root, { session: sessionB, faction: "Dwarf", client });
    root.querySelector<HTMLInputElement>("#gc-duel-code")!.value = "abcd2345";
    root.querySelector<HTMLButtonElement>('[data-act="join"]')!.click();
    await flush();
    // The creator started the match; the room row flips to active.
    client.push(room({ player_two: B, status: "active", match_id: "match-1" }));
    await flush();
    expect(client.getMatch).toHaveBeenCalledWith("match-1");
    expect(client.startMatch).not.toHaveBeenCalled(); // never the joiner's job
    const board = root.querySelector<HTMLElement>(".play-match")!;
    expect(board).not.toBeNull();
    // Joiner POV: their own (Dwarf) accent, waiting on the creator's move.
    expect(board.dataset["faction"]).toBe("Dwarf");
    expect(board.querySelector(".play-match__phase-state")!.textContent).toBe(
      "Opponent's turn",
    );
  });

  it("concede pushes the abandoned status and exits", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    const onExit = vi.fn();
    mount(root, { client, onExit });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    client.push(
      room({
        player_two: B,
        player_one_ready: true,
        player_two_ready: true,
        player_one_deck: { faction: "Sonic", entries: null },
        player_two_deck: { faction: "Dwarf", entries: null },
      }),
    );
    await flush();
    root.querySelector<HTMLButtonElement>(".play-match__quit")!.click();
    await flush();
    expect(client.pushMatch).toHaveBeenCalledWith(
      "match-1",
      0,
      expect.objectContaining({ status: "abandoned", winner: B }),
    );
    expect(onExit).toHaveBeenCalled();
  });
});

describe("mountDuel — crash/refresh recovery", () => {
  it("offers Continue/Concede when an active duel is found on mount", async () => {
    const root = document.createElement("div");
    const client = fakeClient({
      listMyActiveMatches: vi.fn().mockResolvedValue([matchRow()]),
    });
    mount(root, { client });
    await flush();
    expect(root.textContent).toContain("You have an unfinished duel.");
    expect(root.querySelector('[data-act="continue"]')).not.toBeNull();
    expect(root.querySelector('[data-act="concede"]')).not.toBeNull();
    // The normal home actions are gated behind the prompt.
    expect(root.querySelector('[data-act="create"]')).toBeNull();
  });

  it("picks the most recent duel and warns about stale strays", async () => {
    const root = document.createElement("div");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient({
      listMyActiveMatches: vi
        .fn()
        .mockResolvedValue([matchRow({ id: "match-new" }), matchRow({ id: "match-old" })]),
    });
    mount(root, { client });
    await flush();
    expect(root.textContent).toContain("unfinished duel");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("match-old"));
  });

  it("Continue re-verifies, remounts the arena, and saves the pointer", async () => {
    const root = document.createElement("div");
    const client = fakeClient({
      listMyActiveMatches: vi.fn().mockResolvedValue([matchRow()]),
    });
    mount(root, { client });
    await flush();
    root.querySelector<HTMLButtonElement>('[data-act="continue"]')!.click();
    await flush();
    expect(client.getMatch).toHaveBeenCalledWith("match-1");
    expect(root.querySelector(".gc-duel--arena")).not.toBeNull();
    expect(client.subscribeMatch).toHaveBeenCalledTimes(1);
    expect(loadPvpPointer(localStorage, A)?.matchId).toBe("match-1");
  });

  it("Concede closes the row for the opponent and returns home", async () => {
    const root = document.createElement("div");
    savePvpPointer(localStorage, { userId: A, matchId: "match-1", roomId: "room-1" });
    const client = fakeClient({
      listMyActiveMatches: vi.fn().mockResolvedValue([matchRow()]),
    });
    mount(root, { client });
    await flush();
    root.querySelector<HTMLButtonElement>('[data-act="concede"]')!.click();
    await flush();
    expect(client.pushMatch).toHaveBeenCalledWith(
      "match-1",
      0,
      expect.objectContaining({ status: "abandoned", winner: B }),
    );
    expect(root.querySelector('[data-act="create"]')).not.toBeNull(); // home again
    expect(root.textContent).toContain("You conceded the duel.");
    expect(loadPvpPointer(localStorage, A)).toBeNull();
  });

  it("shows the result (not the prompt) when the duel ended while away", async () => {
    const root = document.createElement("div");
    savePvpPointer(localStorage, { userId: A, matchId: "match-1", roomId: "room-1" });
    const ended = matchRow({ status: "abandoned", winner: A });
    const client = fakeClient({
      listMyActiveMatches: vi.fn().mockResolvedValue([]),
      getMatch: vi.fn().mockResolvedValue(ended),
    });
    mount(root, { client });
    await flush();
    expect(root.querySelector(".gc-duel__result")).not.toBeNull();
    expect(root.textContent).toContain("Victory");
    expect(root.textContent).toContain("conceded");
    expect(loadPvpPointer(localStorage, A)).toBeNull();
  });

  it("drops a stale pointer whose match row is gone, and shows plain home", async () => {
    const root = document.createElement("div");
    savePvpPointer(localStorage, { userId: A, matchId: "match-gone", roomId: "room-1" });
    const client = fakeClient({
      listMyActiveMatches: vi.fn().mockResolvedValue([]),
      getMatch: vi.fn().mockResolvedValue(null),
    });
    mount(root, { client });
    await flush();
    expect(root.querySelector('[data-act="create"]')).not.toBeNull();
    expect(localStorage.getItem(PVP_POINTER_KEY)).toBeNull();
  });

  it("ignores another user's pointer (version-checked envelope intact)", async () => {
    const root = document.createElement("div");
    localStorage.setItem(
      PVP_POINTER_KEY,
      JSON.stringify({
        version: PVP_POINTER_VERSION,
        userId: "someone-else",
        matchId: "match-1",
        roomId: "room-1",
        savedAt: new Date().toISOString(),
      }),
    );
    const client = fakeClient({ listMyActiveMatches: vi.fn().mockResolvedValue([]) });
    mount(root, { client });
    await flush();
    expect(client.getMatch).not.toHaveBeenCalled();
    expect(root.querySelector('[data-act="create"]')).not.toBeNull();
  });

  it("a pending invite takes priority over the recovery check", async () => {
    const root = document.createElement("div");
    const list = vi.fn().mockResolvedValue([matchRow()]);
    const client = fakeClient({ listMyActiveMatches: list });
    mount(root, { session: sessionB, pendingInvite: "abcd2345", client });
    await flush();
    expect(client.joinByCode).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
