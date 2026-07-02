/**
 * 1v1 private-invite PvP — data layer (Phase 1: lobby; Phase 2: live match).
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
 *
 * Phase 2 sync model: a match is ONE canonical deterministic game — creator =
 * seat player1, joiner = player2 — persisted as `seed + both decks + ordered
 * action_log` in `pvp_matches`. Only the active player appends actions, guarded
 * by an optimistic `version` column; the other client replays the tail it
 * hasn't seen. Board state is never synced. PvP grants NO rewards.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameAction } from "@euphoria/game-engine";
import { getSupabaseClient } from "@euphoria/core/supabase-client";
import type { AuthSession } from "@euphoria/core/auth";
import { STARTER_FACTIONS, type DeckEntry, type StarterFaction } from "@euphoria/core/starter";

export type PvpRoomStatus = "waiting" | "ready" | "active" | "completed" | "abandoned";

/**
 * A player's published deck for a duel: their faction plus their saved custom
 * deck entries, or `entries: null` for the faction's fixed starter deck. Stored
 * as jsonb on the room (published on ready-up) and copied into the match row.
 */
export interface PvpDeckPayload {
  readonly faction: StarterFaction;
  readonly entries: readonly DeckEntry[] | null;
}

/** A row of `public.pvp_rooms`, narrowed to the fields the lobby uses. */
export interface PvpRoom {
  readonly id: string;
  readonly room_code: string;
  readonly created_by: string;
  readonly player_one: string;
  readonly player_two: string | null;
  readonly player_one_ready: boolean;
  readonly player_two_ready: boolean;
  readonly player_one_deck: PvpDeckPayload | null;
  readonly player_two_deck: PvpDeckPayload | null;
  readonly status: PvpRoomStatus;
  readonly match_id: string | null;
  readonly expires_at: string; // ISO timestamp
}

export type PvpMatchStatus = "active" | "completed" | "abandoned";

/** A row of `public.pvp_matches` — the canonical synced game. */
export interface PvpMatch {
  readonly id: string;
  readonly room_id: string;
  readonly player_one: string;
  readonly player_two: string;
  readonly seed: number;
  readonly player_one_deck: PvpDeckPayload | null;
  readonly player_two_deck: PvpDeckPayload | null;
  /** The uuid of the player whose turn it is (display/turn hint; null = over). */
  readonly current_player: string | null;
  readonly status: PvpMatchStatus;
  /** The full ordered action log of the canonical game. */
  readonly action_log: readonly GameAction[];
  /** Optimistic-concurrency counter; every push must name the version it saw. */
  readonly version: number;
  /** The winner's uuid once the match completes (null while live / on draw). */
  readonly winner: string | null;
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

/**
 * The canonical engine seat a user occupies: the creator (player_one) is always
 * seat "player1", the joiner "player2". Null when the user isn't a participant.
 */
export function seatOf(
  row: Pick<PvpMatch, "player_one" | "player_two"> | Pick<PvpRoom, "player_one" | "player_two">,
  userId: string,
): "player1" | "player2" | null {
  if (userId === row.player_one) return "player1";
  if (userId === row.player_two) return "player2";
  return null;
}

/** The uuid seated at a canonical engine seat (inverse of {@link seatOf}). */
export function uidAtSeat(
  row: Pick<PvpMatch, "player_one" | "player_two">,
  seat: "player1" | "player2",
): string {
  return seat === "player1" ? row.player_one : row.player_two;
}

/** Which deck column a given user controls in a room (null if not a member). */
export function deckColumnFor(
  room: PvpRoom,
  userId: string,
): "player_one_deck" | "player_two_deck" | null {
  if (userId === room.player_one) return "player_one_deck";
  if (userId === room.player_two) return "player_two_deck";
  return null;
}

/**
 * Validates an untrusted jsonb deck payload from the opponent's client. Returns
 * the typed payload, or null when malformed — the caller treats null as "use
 * the starter deck is impossible; abort the match start with an error" for a
 * present-but-broken payload, and distinguishes it from an absent one itself.
 * (Deck LEGALITY — sizes, copy limits, ownership — is enforced when the deck is
 * expanded against the local pool; this only guards the shape.)
 */
export function coerceDeckPayload(value: unknown): PvpDeckPayload | null {
  if (value === null || typeof value !== "object") return null;
  const obj = value as { faction?: unknown; entries?: unknown };
  if (
    typeof obj.faction !== "string" ||
    !(STARTER_FACTIONS as readonly string[]).includes(obj.faction)
  ) {
    return null;
  }
  if (obj.entries === null || obj.entries === undefined) {
    return { faction: obj.faction as StarterFaction, entries: null };
  }
  if (!Array.isArray(obj.entries)) return null;
  const entries: DeckEntry[] = [];
  for (const raw of obj.entries) {
    const e = raw as { slug?: unknown; quantity?: unknown };
    if (
      typeof e?.slug !== "string" ||
      typeof e?.quantity !== "number" ||
      !Number.isInteger(e.quantity) ||
      e.quantity <= 0
    ) {
      return null;
    }
    entries.push({ slug: e.slug, quantity: e.quantity });
  }
  return { faction: obj.faction as StarterFaction, entries };
}

/** Result of an optimistic-concurrency match push. */
export type PushResult =
  | { readonly ok: true; readonly match: PvpMatch }
  | {
      readonly ok: false;
      /** True when the version check failed (someone else wrote first). */
      readonly conflict: boolean;
      readonly message: string;
    };

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

/** The lobby + live-match operations the duel view needs. Backed by Supabase. */
export interface PvpClient {
  /** Creates a fresh waiting room owned by the current user. */
  createRoom(): Promise<PvpRoom>;
  /** Joins a waiting room by code via the SECURITY DEFINER RPC. */
  joinByCode(code: string): Promise<{ room?: PvpRoom; error?: string }>;
  /** Loads a room the current user participates in. */
  getRoom(roomId: string): Promise<PvpRoom | null>;
  /**
   * Sets the current user's ready flag. When readying up (`ready: true`) the
   * caller passes the deck they'll duel with; it's published on the room row in
   * the same update so the creator can start the match with both decks known.
   */
  setReady(room: PvpRoom, ready: boolean, deck?: PvpDeckPayload): Promise<PvpRoom>;
  /** Leaves/abandons the room (owner abandons; opponent clears their seat). */
  leaveRoom(room: PvpRoom): Promise<void>;
  /** Subscribes to row changes; returns an unsubscribe. Realtime + poll fallback. */
  subscribeRoom(roomId: string, onChange: (room: PvpRoom) => void): () => void;

  // ---- Phase 2: the live match ------------------------------------------
  /**
   * Creator only: creates the canonical match row for a both-ready room (seed +
   * both published decks, empty action log) and flips the room to `active` with
   * `match_id` set. The joiner never calls this — they see `match_id` appear on
   * the room and load the match. Callers must check `room.match_id === null`
   * first (a re-run would insert a second row; the room only ever points at one).
   */
  startMatch(room: PvpRoom, seed: number): Promise<PvpMatch>;
  /** Loads a match the current user participates in. */
  getMatch(matchId: string): Promise<PvpMatch | null>;
  /**
   * Appends to the canonical game: writes the full action log plus turn/result
   * metadata, guarded by the `version` the caller last saw. A conflict (someone
   * else wrote first) comes back as `{ ok: false, conflict: true }` so the
   * controller can re-fetch and reconcile instead of overwriting.
   */
  pushMatch(
    matchId: string,
    expectedVersion: number,
    patch: {
      readonly action_log: readonly GameAction[];
      readonly current_player: string | null;
      readonly status?: PvpMatchStatus;
      readonly winner?: string | null;
    },
  ): Promise<PushResult>;
  /** Subscribes to match-row changes; realtime + poll fallback, like rooms. */
  subscribeMatch(matchId: string, onChange: (match: PvpMatch) => void): () => void;
}

const ROOM_COLUMNS =
  "id,room_code,created_by,player_one,player_two,player_one_ready,player_two_ready,player_one_deck,player_two_deck,status,match_id,expires_at";
const MATCH_COLUMNS =
  "id,room_id,player_one,player_two,seed,player_one_deck,player_two_deck,current_player,status,action_log,version,winner";
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

    async setReady(room: PvpRoom, ready: boolean, deck?: PvpDeckPayload): Promise<PvpRoom> {
      const column = readyColumnFor(room, uid);
      if (column === null) throw new Error("You are not a member of this room.");
      const patch: Record<string, unknown> = { [column]: ready };
      // Publish (or clear) the duel deck alongside the flag in one update.
      const deckColumn = deckColumnFor(room, uid);
      if (deckColumn !== null && (deck !== undefined || !ready)) {
        patch[deckColumn] = ready ? deck : null;
      }
      const { data, error } = await client
        .from("pvp_rooms")
        .update(patch)
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

    // ---- Phase 2: the live match ------------------------------------------

    async startMatch(room: PvpRoom, seed: number): Promise<PvpMatch> {
      if (room.created_by !== uid) throw new Error("Only the room creator starts the match.");
      if (room.player_two === null) throw new Error("The room has no opponent yet.");
      const { data, error } = await client
        .from("pvp_matches")
        .insert({
          room_id: room.id,
          player_one: room.player_one,
          player_two: room.player_two,
          seed,
          player_one_deck: room.player_one_deck,
          player_two_deck: room.player_two_deck,
          current_player: room.player_one, // player1 always moves first
          status: "active",
          action_log: [],
        })
        .select(MATCH_COLUMNS)
        .single();
      if (error !== null) throw new Error(error.message);
      const match = data as PvpMatch;
      const { error: roomError } = await client
        .from("pvp_rooms")
        .update({ status: "active", match_id: match.id })
        .eq("id", room.id);
      if (roomError !== null) throw new Error(roomError.message);
      return match;
    },

    async getMatch(matchId: string): Promise<PvpMatch | null> {
      const { data, error } = await client
        .from("pvp_matches")
        .select(MATCH_COLUMNS)
        .eq("id", matchId)
        .maybeSingle();
      if (error !== null) throw new Error(error.message);
      return (data as PvpMatch | null) ?? null;
    },

    async pushMatch(
      matchId: string,
      expectedVersion: number,
      patch: {
        readonly action_log: readonly GameAction[];
        readonly current_player: string | null;
        readonly status?: PvpMatchStatus;
        readonly winner?: string | null;
      },
    ): Promise<PushResult> {
      const { data, error } = await client
        .from("pvp_matches")
        .update({ ...patch, version: expectedVersion + 1 })
        .eq("id", matchId)
        .eq("version", expectedVersion)
        .select(MATCH_COLUMNS)
        .maybeSingle();
      if (error !== null) return { ok: false, conflict: false, message: error.message };
      if (data === null) {
        // The version filter matched nothing: someone else wrote first (or the
        // row is gone). The caller re-fetches and reconciles.
        return { ok: false, conflict: true, message: "The match was updated by the other player." };
      }
      return { ok: true, match: data as PvpMatch };
    },

    subscribeMatch(matchId: string, onChange: (match: PvpMatch) => void): () => void {
      let closed = false;
      const emit = (match: PvpMatch | null): void => {
        if (!closed && match !== null) onChange(match);
      };
      const channel = client
        .channel(`pvp_match:${matchId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pvp_matches", filter: `id=eq.${matchId}` },
          (payload: { new?: unknown }) => emit((payload.new as PvpMatch | undefined) ?? null),
        )
        .subscribe();
      const timer = setInterval(() => {
        void this.getMatch(matchId).then(emit).catch(() => {});
      }, POLL_INTERVAL_MS);
      return () => {
        closed = true;
        clearInterval(timer);
        void client.removeChannel(channel);
      };
    },
  };
}
