/**
 * PvP data-layer tests (Phase 1): room-code generation, invite-link parsing,
 * join guards, ready-column logic, and the Supabase-backed client with an
 * injected fake. No engine / auth / reward code is exercised.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateRoomCode,
  isValidRoomCode,
  parseInviteCode,
  buildInviteLink,
  canJoinRoom,
  readyColumnFor,
  bothReady,
  coerceDeckPayload,
  createPvpClient,
  deckColumnFor,
  seatOf,
  uidAtSeat,
  type PvpMatch,
  type PvpRoom,
} from "../src/pvp";

const A = "user-a";
const B = "user-b";

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

describe("generateRoomCode", () => {
  it("produces valid, unambiguous, unique-ish codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const c = generateRoomCode();
      expect(c).toHaveLength(8);
      expect(isValidRoomCode(c)).toBe(true);
      // No visually ambiguous characters.
      expect(/[01oil]/.test(c)).toBe(false);
      codes.add(c);
    }
    expect(codes.size).toBeGreaterThan(190); // effectively no collisions
  });
});

describe("parseInviteCode", () => {
  it("reads ?invite= from a query string, URL, or Location-like object", () => {
    expect(parseInviteCode("?invite=abcd2345")).toBe("abcd2345");
    expect(parseInviteCode("https://x.dev/beta/?invite=abcd2345")).toBe("abcd2345");
    expect(parseInviteCode({ search: "?invite=abcd2345", hash: "" })).toBe("abcd2345");
    expect(parseInviteCode("invite=abcd2345")).toBe("abcd2345");
  });
  it("reads #invite= from a hash", () => {
    expect(parseInviteCode("#invite=abcd2345")).toBe("abcd2345");
    expect(parseInviteCode({ hash: "#invite=abcd2345" })).toBe("abcd2345");
  });
  it("normalizes case and rejects junk / missing codes", () => {
    expect(parseInviteCode("?invite=ABCD2345")).toBe("abcd2345");
    expect(parseInviteCode("?invite=")).toBeNull();
    expect(parseInviteCode("?foo=bar")).toBeNull();
    expect(parseInviteCode("?invite=has spaces")).toBeNull();
    expect(parseInviteCode("?invite=$$$")).toBeNull();
    expect(parseInviteCode(null)).toBeNull();
    expect(parseInviteCode(undefined)).toBeNull();
  });
});

describe("buildInviteLink", () => {
  it("joins base + code (trailing slash normalized)", () => {
    expect(buildInviteLink("/beta/", "abcd2345")).toContain("/beta/?invite=abcd2345");
    expect(buildInviteLink("/beta", "abcd2345")).toContain("/beta/?invite=abcd2345");
  });
});

describe("canJoinRoom", () => {
  it("allows joining an open waiting room", () => {
    expect(canJoinRoom(room(), B)).toEqual({ ok: true });
  });
  it("lets the existing opponent rejoin (reload-safe)", () => {
    expect(canJoinRoom(room({ player_two: B, status: "ready" }), B)).toEqual({ ok: true });
  });
  it("rejects a missing room", () => {
    expect(canJoinRoom(null, B)).toEqual({ ok: false, reason: "not-found" });
  });
  it("rejects an expired room", () => {
    const expired = room({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(canJoinRoom(expired, B)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects the creator joining their own room as opponent", () => {
    expect(canJoinRoom(room(), A)).toEqual({ ok: false, reason: "own-room" });
  });
  it("rejects joining a full room", () => {
    expect(canJoinRoom(room({ player_two: "user-c" }), B)).toEqual({ ok: false, reason: "full" });
  });
  it("rejects a room that has left the waiting state", () => {
    // status active with no player_two set (edge) — not open to a new joiner.
    expect(canJoinRoom(room({ status: "active" }), B)).toEqual({ ok: false, reason: "not-open" });
  });
});

describe("readyColumnFor / bothReady", () => {
  it("maps each member to their ready column", () => {
    const r = room({ player_two: B });
    expect(readyColumnFor(r, A)).toBe("player_one_ready");
    expect(readyColumnFor(r, B)).toBe("player_two_ready");
    expect(readyColumnFor(r, "stranger")).toBeNull();
  });
  it("is only both-ready when both seats are filled and readied", () => {
    expect(bothReady(room({ player_two: B, player_one_ready: true, player_two_ready: true }))).toBe(true);
    expect(bothReady(room({ player_two: B, player_one_ready: true, player_two_ready: false }))).toBe(false);
    expect(bothReady(room({ player_two: null, player_one_ready: true }))).toBe(false);
  });
});

describe("createPvpClient", () => {
  const session = { userId: A, email: "a@x.dev" };

  it("returns null when Supabase is not configured", () => {
    expect(createPvpClient(session, { client: null })).toBeNull();
  });

  it("createRoom inserts a waiting room owned by the caller", async () => {
    const single = vi.fn().mockResolvedValue({ data: room(), error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const fake = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    const r = await client.createRoom();
    expect(r.player_one).toBe(A);
    const payload = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.created_by).toBe(A);
    expect(payload.player_one).toBe(A);
    expect(payload.status).toBe("waiting");
    expect(isValidRoomCode(payload.room_code as string)).toBe(true);
  });

  it("joinByCode calls the join_pvp_room RPC and returns the room", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: room({ player_two: B }), error: null });
    const fake = { rpc } as unknown as SupabaseClient;
    const client = createPvpClient({ userId: B, email: "b@x.dev" }, { client: fake })!;
    const res = await client.joinByCode("abcd2345");
    expect(rpc).toHaveBeenCalledWith("join_pvp_room", { p_code: "abcd2345" });
    expect(res.room?.player_two).toBe(B);
  });

  it("joinByCode surfaces an RPC error without throwing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "room full" } });
    const fake = { rpc } as unknown as SupabaseClient;
    const client = createPvpClient({ userId: B, email: "b@x.dev" }, { client: fake })!;
    const res = await client.joinByCode("abcd2345");
    expect(res.error).toContain("full");
  });

  it("setReady updates the caller's own ready column", async () => {
    const single = vi.fn().mockResolvedValue({ data: room({ player_one_ready: true }), error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    const fake = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    await client.setReady(room(), true);
    expect(update).toHaveBeenCalledWith({ player_one_ready: true });
  });

  it("setReady publishes the duel deck on ready-up and clears it on cancel", async () => {
    const single = vi.fn().mockResolvedValue({ data: room(), error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    const fake = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    const deck = { faction: "Sonic" as const, entries: null };
    await client.setReady(room(), true, deck);
    expect(update).toHaveBeenLastCalledWith({ player_one_ready: true, player_one_deck: deck });
    await client.setReady(room(), false);
    expect(update).toHaveBeenLastCalledWith({ player_one_ready: false, player_one_deck: null });
  });
});

// ---------------------------------------------------------------------------
// Phase 2: seats, deck payloads, and the live-match client operations
// ---------------------------------------------------------------------------

function matchRow(over: Partial<PvpMatch> = {}): PvpMatch {
  return {
    id: "match-1",
    room_id: "room-1",
    player_one: A,
    player_two: B,
    seed: 42,
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

describe("seatOf / uidAtSeat / deckColumnFor", () => {
  it("maps the creator to player1 and the joiner to player2", () => {
    const m = matchRow();
    expect(seatOf(m, A)).toBe("player1");
    expect(seatOf(m, B)).toBe("player2");
    expect(seatOf(m, "stranger")).toBeNull();
    expect(uidAtSeat(m, "player1")).toBe(A);
    expect(uidAtSeat(m, "player2")).toBe(B);
  });

  it("maps deck columns to room membership", () => {
    const r = room({ player_two: B });
    expect(deckColumnFor(r, A)).toBe("player_one_deck");
    expect(deckColumnFor(r, B)).toBe("player_two_deck");
    expect(deckColumnFor(r, "stranger")).toBeNull();
  });
});

describe("coerceDeckPayload", () => {
  it("accepts a starter payload and a custom-entries payload", () => {
    expect(coerceDeckPayload({ faction: "Sonic", entries: null })).toEqual({
      faction: "Sonic",
      entries: null,
    });
    expect(
      coerceDeckPayload({ faction: "Monk", entries: [{ slug: "kit", quantity: 2 }] }),
    ).toEqual({ faction: "Monk", entries: [{ slug: "kit", quantity: 2 }] });
  });

  it("rejects malformed payloads", () => {
    expect(coerceDeckPayload(null)).toBeNull();
    expect(coerceDeckPayload("Sonic")).toBeNull();
    expect(coerceDeckPayload({ faction: "Shaman", entries: null })).toBeNull(); // not a starter faction
    expect(coerceDeckPayload({ faction: "Sonic", entries: [{ slug: 3, quantity: 1 }] })).toBeNull();
    expect(coerceDeckPayload({ faction: "Sonic", entries: [{ slug: "kit", quantity: 0 }] })).toBeNull();
    expect(coerceDeckPayload({ faction: "Sonic", entries: [{ slug: "kit", quantity: 1.5 }] })).toBeNull();
  });
});

describe("createPvpClient — match operations", () => {
  const session = { userId: A, email: "a@x.dev" };

  it("startMatch inserts the canonical match and activates the room", async () => {
    const inserted = matchRow();
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const roomEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: roomEq });
    const from = vi.fn((table: string) =>
      table === "pvp_matches" ? { insert } : { update },
    );
    const fake = { from } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    const readyRoom = room({
      player_two: B,
      player_one_ready: true,
      player_two_ready: true,
      player_one_deck: { faction: "Sonic", entries: null },
      player_two_deck: { faction: "Dwarf", entries: null },
    });
    const m = await client.startMatch(readyRoom, 42);
    expect(m.id).toBe("match-1");
    const payload = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.player_one).toBe(A);
    expect(payload.player_two).toBe(B);
    expect(payload.seed).toBe(42);
    expect(payload.current_player).toBe(A); // player1 moves first
    expect(payload.action_log).toEqual([]);
    expect(update).toHaveBeenCalledWith({ status: "active", match_id: "match-1" });
  });

  it("startMatch refuses a non-creator and a room with no opponent", async () => {
    const fake = { from: vi.fn() } as unknown as SupabaseClient;
    const joiner = createPvpClient({ userId: B, email: "b@x.dev" }, { client: fake })!;
    await expect(joiner.startMatch(room({ player_two: B }), 1)).rejects.toThrow(/creator/);
    const creator = createPvpClient(session, { client: fake })!;
    await expect(creator.startMatch(room(), 1)).rejects.toThrow(/opponent/);
  });

  it("pushMatch writes log + version with the optimistic version filter", async () => {
    const pushed = matchRow({ version: 1, action_log: [{ kind: "endTurn" }] as never });
    const maybeSingle = vi.fn().mockResolvedValue({ data: pushed, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqVersion = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqVersion });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    const fake = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    const res = await client.pushMatch("match-1", 0, {
      action_log: [{ kind: "endTurn" } as never],
      current_player: B,
    });
    expect(res.ok).toBe(true);
    const payload = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.version).toBe(1);
    expect(eqId).toHaveBeenCalledWith("id", "match-1");
    expect(eqVersion).toHaveBeenCalledWith("version", 0);
  });

  it("pushMatch reports a conflict when the version filter matches nothing", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqVersion = vi.fn().mockReturnValue({ select });
    const eqId = vi.fn().mockReturnValue({ eq: eqVersion });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    const fake = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const client = createPvpClient(session, { client: fake })!;
    const res = await client.pushMatch("match-1", 3, { action_log: [], current_player: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe(true);
  });
});
