/**
 * 1v1 private-invite PvP — data layer (Phase 1: lobby only).
 *
 * DOM-free and framework-free so it can be unit-tested and later reused by the
 * live-match sync (Phase 2). This module is NEW and NOT part of the ENGINE_LOCK
 * protected surface: it adds the `pvp_rooms` / `pvp_matches` tables (see
 * docs/pvp-schema.sql) alongside the existing schema and never touches the
 * protected auth / reward / match-record tables.
 *
 * Security model: room codes are secret and hard to guess; joining goes through
 * a SECURITY DEFINER RPC (`join_pvp_room`) so non-participants never read the
 * rooms table directly (RLS restricts SELECT/UPDATE to participants).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@euphoria/core/supabase-client";
import type { AuthSession } from "@euphoria/core/auth";

export type PvpRoomStatus = "waiting" | "ready" | "active" | "completed" | "abandoned";

/** A row of `public.pvp_rooms`, narrowed to the fields the lobby uses. */
export interface PvpRoom {
  readonly id: string;
  readonly room_code: string;
  readonly created_by: string;
  readonly player_one: string;
  readonly player_two: string | null;
  readonly player_one_ready: boolean;
  readonly player_two_ready: boolean;
  readonly status: PvpRoomStatus;
  readonly match_id: string | null;
  readonly expires_at: string; // ISO timestamp
}

/** How long a freshly-created invite stays joinable. */
export const ROOM_TTL_MS = 30 * 60 * 1000;

// Unambiguous lowercase alphabet (no 0/o/1/l/i) for readable, copy-safe codes.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;

/**
 * Generates a random, hard-to-guess room code (~31^8 ≈ 8.5e11 space). Uses the
 * Web Crypto RNG when available, falling back to Math.random in bare test envs.
 */
export function generateRoomCode(length: number = CODE_LENGTH): string {
  const n = CODE_ALPHABET.length;
  const bytes = new Uint8Array(length);
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues !== undefined) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i]! % n];
  return out;
}

/** True when a string is a syntactically valid room code. */
export function isValidRoomCode(code: string): boolean {
  return /^[a-z0-9]{6,16}$/.test(code);
}

/**
 * Extracts an invite code from a URL, a query string (`?invite=CODE`), or a hash
 * (`#invite=CODE`). Returns the normalized (lowercased) code, or null if absent
 * or malformed. Accepts a raw string or a Location-like object.
 */
export function parseInviteCode(
  input: string | { search?: string; hash?: string } | null | undefined,
): string | null {
  if (input === null || input === undefined) return null;
  let search = "";
  let hash = "";
  if (typeof input === "string") {
    // Split a full/partial URL into its query and hash parts.
    const qIndex = input.indexOf("?");
    const hIndex = input.indexOf("#");
    if (hIndex >= 0) hash = input.slice(hIndex);
    if (qIndex >= 0) search = input.slice(qIndex, hIndex >= 0 ? hIndex : undefined);
    if (qIndex < 0 && hIndex < 0 && input.includes("invite=")) search = `?${input}`;
  } else {
    search = input.search ?? "";
    hash = input.hash ?? "";
  }
  const fromQuery = new URLSearchParams(search.replace(/^\?/, "")).get("invite");
  const fromHash = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
  const raw = (fromQuery ?? fromHash ?? "").trim().toLowerCase();
  return raw !== "" && isValidRoomCode(raw) ? raw : null;
}

/** Builds the shareable invite link for a room code, e.g. `/beta/?invite=abc`. */
export function buildInviteLink(base: string, code: string): string {
  const origin =
    typeof window !== "undefined" && window.location !== undefined
      ? window.location.origin
      : "";
  const path = base.endsWith("/") ? base : `${base}/`;
  return `${origin}${path}?invite=${encodeURIComponent(code)}`;
}

/** Why a join attempt is or isn't allowed — pure, so it's exhaustively testable. */
export type JoinCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "expired" | "own-room" | "full" | "not-open";
    };

/**
 * Decides whether `userId` may join `room` at time `nowMs`. Enforces: no joining
 * a missing/expired room, your own invite as the opponent, a full room, or a
 * room that has already left the waiting state (rejoining as the existing
 * player_two is allowed, e.g. after a reload).
 */
export function canJoinRoom(
  room: PvpRoom | null,
  userId: string,
  nowMs: number = Date.now(),
): JoinCheck {
  if (room === null) return { ok: false, reason: "not-found" };
  if (userId === room.player_two) return { ok: true }; // rejoin as existing opponent
  if (Date.parse(room.expires_at) <= nowMs) return { ok: false, reason: "expired" };
  if (userId === room.player_one) return { ok: false, reason: "own-room" };
  if (room.player_two !== null) return { ok: false, reason: "full" };
  if (room.status !== "waiting") return { ok: false, reason: "not-open" };
  return { ok: true };
}

/** Which ready column a given user controls in a room (null if not a member). */
export function readyColumnFor(
  room: PvpRoom,
  userId: string,
): "player_one_ready" | "player_two_ready" | null {
  if (userId === room.player_one) return "player_one_ready";
  if (userId === room.player_two) return "player_two_ready";
  return null;
}

/** True once both seats are filled and both players have readied up. */
export function bothReady(room: PvpRoom): boolean {
  return (
    room.player_two !== null && room.player_one_ready && room.player_two_ready
  );
}

/** Human-readable message for a failed join. */
export function joinErrorMessage(reason: Exclude<JoinCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "not-found":
      return "That invite link is invalid or has already been used.";
    case "expired":
      return "This invite has expired. Ask your friend to create a new one.";
    case "own-room":
      return "That's your own invite — share the link with a friend to play.";
    case "full":
      return "This room is already full.";
    case "not-open":
      return "This match has already started or ended.";
  }
}

/** The lobby operations the duel view needs. Backed by Supabase. */
export interface PvpClient {
  /** Creates a fresh waiting room owned by the current user. */
  createRoom(): Promise<PvpRoom>;
  /** Joins a waiting room by code via the SECURITY DEFINER RPC. */
  joinByCode(code: string): Promise<{ room?: PvpRoom; error?: string }>;
  /** Loads a room the current user participates in. */
  getRoom(roomId: string): Promise<PvpRoom | null>;
  /** Sets the current user's ready flag. */
  setReady(room: PvpRoom, ready: boolean): Promise<PvpRoom>;
  /** Leaves/abandons the room (owner abandons; opponent clears their seat). */
  leaveRoom(room: PvpRoom): Promise<void>;
  /** Subscribes to row changes; returns an unsubscribe. Realtime + poll fallback. */
  subscribeRoom(roomId: string, onChange: (room: PvpRoom) => void): () => void;
}

const ROOM_COLUMNS =
  "id,room_code,created_by,player_one,player_two,player_one_ready,player_two_ready,status,match_id,expires_at";
const POLL_INTERVAL_MS = 2500;

/**
 * Builds a Supabase-backed PvP client, or null when Supabase isn't configured
 * (the localStorage demo can't do cross-browser PvP, so the duel screen degrades
 * gracefully). `deps` allows injecting a client in tests.
 */
export function createPvpClient(
  session: AuthSession,
  deps?: { readonly client?: SupabaseClient | null },
): PvpClient | null {
  const client = deps?.client ?? getSupabaseClient();
  if (client === null) return null;
  const uid = session.userId;

  return {
    async createRoom(): Promise<PvpRoom> {
      const now = Date.now();
      const { data, error } = await client
        .from("pvp_rooms")
        .insert({
          room_code: generateRoomCode(),
          created_by: uid,
          player_one: uid,
          player_one_ready: false,
          player_two_ready: false,
          status: "waiting",
          expires_at: new Date(now + ROOM_TTL_MS).toISOString(),
        })
        .select(ROOM_COLUMNS)
        .single();
      if (error !== null) throw new Error(error.message);
      return data as PvpRoom;
    },

    async joinByCode(code: string): Promise<{ room?: PvpRoom; error?: string }> {
      const normalized = code.trim().toLowerCase();
      if (!isValidRoomCode(normalized)) return { error: joinErrorMessage("not-found") };
      const { data, error } = await client.rpc("join_pvp_room", { p_code: normalized });
      if (error !== null) return { error: error.message };
      const room = (Array.isArray(data) ? data[0] : data) as PvpRoom | null;
      if (room === null || room === undefined) return { error: joinErrorMessage("not-found") };
      return { room };
    },

    async getRoom(roomId: string): Promise<PvpRoom | null> {
      const { data, error } = await client
        .from("pvp_rooms")
        .select(ROOM_COLUMNS)
        .eq("id", roomId)
        .maybeSingle();
      if (error !== null) throw new Error(error.message);
      return (data as PvpRoom | null) ?? null;
    },

    async setReady(room: PvpRoom, ready: boolean): Promise<PvpRoom> {
      const column = readyColumnFor(room, uid);
      if (column === null) throw new Error("You are not a member of this room.");
      const { data, error } = await client
        .from("pvp_rooms")
        .update({ [column]: ready })
        .eq("id", room.id)
        .select(ROOM_COLUMNS)
        .single();
      if (error !== null) throw new Error(error.message);
      return data as PvpRoom;
    },

    async leaveRoom(room: PvpRoom): Promise<void> {
      if (room.created_by === uid) {
        await client.from("pvp_rooms").update({ status: "abandoned" }).eq("id", room.id);
      } else if (room.player_two === uid) {
        await client
          .from("pvp_rooms")
          .update({ player_two: null, player_two_ready: false, status: "waiting" })
          .eq("id", room.id);
      }
    },

    subscribeRoom(roomId: string, onChange: (room: PvpRoom) => void): () => void {
      let closed = false;
      const emit = (room: PvpRoom | null): void => {
        if (!closed && room !== null) onChange(room);
      };
      // Realtime (best-effort): push updates as the row changes.
      const channel = client
        .channel(`pvp_room:${roomId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pvp_rooms", filter: `id=eq.${roomId}` },
          (payload: { new?: unknown }) => emit((payload.new as PvpRoom | undefined) ?? null),
        )
        .subscribe();
      // Polling fallback: covers projects without Realtime enabled + missed events.
      const timer = setInterval(() => {
        void this.getRoom(roomId).then(emit).catch(() => {});
      }, POLL_INTERVAL_MS);
      return () => {
        closed = true;
        clearInterval(timer);
        void client.removeChannel(channel);
      };
    },
  };
}
