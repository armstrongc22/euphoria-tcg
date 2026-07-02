/**
 * @vitest-environment jsdom
 *
 * 1v1 Duel lobby (Phase 1) view tests with an injected fake PvP client — no
 * Supabase, engine, or reward code involved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountDuel } from "../src/duel-view";
import type { PvpClient, PvpRoom } from "@euphoria/core/pvp";

const A = "user-a";
const B = "user-b";
const sessionA = { userId: A, email: "a@x.dev" };
const sessionB = { userId: B, email: "b@x.dev" };
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
    status: "waiting",
    match_id: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
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
    push: (r: PvpRoom) => onChange?.(r),
    ...over,
  } as PvpClient & { push: (r: PvpRoom) => void };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe("mountDuel — lobby (Phase 1)", () => {
  it("shows the unavailable panel when there is no PvP client", () => {
    const root = document.createElement("div");
    mountDuel(root, { auth, session: sessionA, base: "/beta/", onExit: () => {}, client: null });
    expect(root.textContent).toContain("duels are unavailable");
  });

  it("renders Create Invite and a join field on the home screen", () => {
    const root = document.createElement("div");
    mountDuel(root, { auth, session: sessionA, base: "/beta/", onExit: () => {}, client: fakeClient() });
    expect(root.querySelector('[data-act="create"]')).not.toBeNull();
    expect(root.querySelector("#gc-duel-code")).not.toBeNull();
    expect(root.querySelector('[data-act="join"]')).not.toBeNull();
  });

  it("creates a room and shows the code + invite link", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mountDuel(root, { auth, session: sessionA, base: "/beta/", onExit: () => {}, client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    expect(client.createRoom).toHaveBeenCalled();
    expect(root.querySelector(".gc-duel__code-value")!.textContent).toBe("abcd2345");
    expect(root.querySelector<HTMLInputElement>(".gc-duel__link")!.value).toContain("?invite=abcd2345");
  });

  it("auto-joins from a pending invite link", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mountDuel(root, {
      auth,
      session: sessionB,
      base: "/beta/",
      pendingInvite: "abcd2345",
      onExit: () => {},
      client,
    });
    await flush();
    expect(client.joinByCode).toHaveBeenCalledWith("abcd2345");
    expect(root.querySelector(".gc-duel__lobby")).not.toBeNull();
  });

  it("shows a friendly error when joining a full room", async () => {
    const root = document.createElement("div");
    const client = fakeClient({ joinByCode: vi.fn().mockResolvedValue({ error: "room full" }) });
    mountDuel(root, { auth, session: sessionB, base: "/beta/", onExit: () => {}, client });
    root.querySelector<HTMLInputElement>("#gc-duel-code")!.value = "abcd2345";
    root.querySelector<HTMLButtonElement>('[data-act="join"]')!.click();
    await flush();
    expect(root.querySelector(".gc-duel__error")!.textContent!.toLowerCase()).toContain("full");
  });

  it("readies up via the client and reflects opponent updates from the subscription", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    mountDuel(root, { auth, session: sessionA, base: "/beta/", onExit: () => {}, client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    // Opponent joins (pushed through the realtime subscription).
    client.push(room({ player_two: B }));
    expect(root.textContent).toContain("Opponent joined!");
    // Ready up.
    root.querySelector<HTMLButtonElement>('[data-act="ready"]')!.click();
    await flush();
    expect(client.setReady).toHaveBeenCalledWith(expect.objectContaining({ id: "room-1" }), true);
    // Both ready -> the live-match "coming soon" state (no match launches in P1).
    client.push(room({ player_two: B, player_one_ready: true, player_two_ready: true }));
    expect(root.textContent).toContain("next update");
  });

  it("leaves the room and calls onExit", async () => {
    const root = document.createElement("div");
    const client = fakeClient();
    const onExit = vi.fn();
    mountDuel(root, { auth, session: sessionA, base: "/beta/", onExit, client });
    root.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-act="leave"]')!.click();
    await flush();
    expect(client.leaveRoom).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });
});
