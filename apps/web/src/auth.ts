/**
 * Auth + profile layer. The app talks to the small `Auth` interface below, which
 * has two interchangeable implementations:
 *
 *   - createSupabaseAuth(client): real email+password accounts and a
 *     public.profiles row per user (RLS scopes each user to their own row).
 *   - createLocalAuth(store):     the existing localStorage demo flow, used when
 *     Supabase env vars are missing so the static site still works.
 *
 * createAuth() picks the Supabase backend when configured, otherwise the local
 * one. Game logic, card data, and the simulator are untouched — this only
 * concerns signup/account state in the web app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@euphoria/core/supabase-client";
import {
  appendLocalMatch,
  computeAccountStats,
  EMPTY_STATS,
  loadLocalMatches,
  MATCH_STORAGE_KEY,
  type AccountStats,
  type MatchHistoryInsert,
  type MatchRecord,
} from "./match-history";
import {
  appendLocalOwned,
  appendLocalRewardEvent,
  loadLocalOwned,
  OWNED_STORAGE_KEY,
  REWARD_EVENTS_STORAGE_KEY,
  type OwnedCardInsert,
  type OwnedCardRecord,
  type RewardEventInsert,
} from "@euphoria/core/rewards";
import {
  ACTIVE_DECK_STORAGE_KEY,
  coerceActiveDeckRow,
  loadLocalActiveDeck,
  saveLocalActiveDeck,
  type ActiveDeckPayload,
  type ActiveDeckRecord,
} from "@euphoria/core/deck-builder";
import type { FeedbackInsert } from "./feedback";
import {
  clearSignup,
  getLocalStore,
  loadSignup,
  recordFaction,
  recordSignup,
  type KeyValueStore,
} from "@euphoria/core/signup";
import { STARTER_FACTIONS, type StarterFaction } from "@euphoria/core/starter";

/** A signed-in user, reduced to what the UI needs. */
export interface AuthSession {
  readonly userId: string;
  readonly email: string;
}

/** A row of public.profiles, narrowed to the fields the app uses. */
export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly selected_faction: StarterFaction | null;
}

/** The exact object upserted into public.profiles when a faction is chosen. */
export interface ProfilePayload {
  readonly id: string;
  readonly email: string;
  readonly selected_faction: StarterFaction;
  readonly updated_at: string;
}

/**
 * Builds the profiles upsert payload. Pure and deterministic (pass `now` in
 * tests). `created_at` is intentionally omitted: it is set by the DB default on
 * insert and must not be overwritten on update.
 */
export function buildProfilePayload(
  session: AuthSession,
  faction: StarterFaction,
  now: Date = new Date(),
): ProfilePayload {
  return {
    id: session.userId,
    email: session.email,
    selected_faction: faction,
    updated_at: now.toISOString(),
  };
}

/** The backend-agnostic auth contract the app depends on. */
export interface Auth {
  /** True for the Supabase backend, false for the localStorage demo fallback. */
  readonly isRemote: boolean;
  /** Create an account. Resolves to the new session (email confirmation is OFF). */
  signUp(email: string, password: string): Promise<AuthSession>;
  /** Sign in to an existing account. */
  signIn(email: string, password: string): Promise<AuthSession>;
  /** Sign out and clear the persisted session. */
  signOut(): Promise<void>;
  /** The current session, or null if nobody is signed in. */
  getSession(): Promise<AuthSession | null>;
  /** Create/update the user's profile with their chosen starter faction. */
  saveFaction(session: AuthSession, faction: StarterFaction): Promise<void>;
  /** The user's profile row, or null if it doesn't exist yet. */
  getProfile(session: AuthSession): Promise<Profile | null>;
  /** Persist one completed test match for the signed-in user. */
  saveMatch(session: AuthSession, match: MatchHistoryInsert): Promise<void>;
  /** The user's match rows, newest first (default cap, never the whole table). */
  getMatchHistory(session: AuthSession, limit?: number): Promise<MatchRecord[]>;
  /**
   * Aggregate win/loss/draw stats over the user's ENTIRE match history — not the
   * capped window getMatchHistory returns. The account win counter and reward
   * progress derive from this, so they keep climbing past 50 lifetime matches.
   */
  getMatchStats(session: AuthSession): Promise<AccountStats>;
  /**
   * Save one chosen reward card: writes both the ownership row (owned_cards)
   * and the choice record (reward_events) for the signed-in user.
   */
  saveReward(
    session: AuthSession,
    owned: OwnedCardInsert,
    event: RewardEventInsert,
  ): Promise<void>;
  /** The user's owned reward cards, newest first (default cap). */
  getOwnedCards(session: AuthSession, limit?: number): Promise<OwnedCardRecord[]>;
  /** Save (upsert) the user's active deck for a faction. */
  saveActiveDeck(session: AuthSession, payload: ActiveDeckPayload): Promise<void>;
  /** The user's saved active deck for a faction, or null if none exists. */
  getActiveDeck(
    session: AuthSession,
    faction: StarterFaction,
  ): Promise<ActiveDeckRecord | null>;
  /**
   * Wipes ALL beta progression for the signed-in user: owned reward cards,
   * reward events, match history, and saved custom decks. Used by the
   * "switch starter deck" reset flow (the faction itself is changed separately
   * via saveFaction). Does NOT touch the resume-match snapshot, which the caller
   * clears (it lives in a separate recovery store).
   */
  resetProgression(session: AuthSession): Promise<void>;
  /**
   * Persist one beta feedback / bug report. Takes no session — the report's
   * user_id (or null for anonymous) is already on the insert, so the footer can
   * send feedback whether or not someone is signed in. Throws on failure so the
   * caller can fall back to the local pending queue (feedback.ts).
   */
  saveFeedback(insert: FeedbackInsert): Promise<void>;
}

/** Columns selected from match_history; mirrors {@link MatchRecord}. */
const MATCH_COLUMNS =
  "user_id, player_faction, opponent_faction, winner, result, turns, " +
  "lives_left_player, lives_left_opponent, warriors_summoned_player, " +
  "warriors_summoned_opponent, direct_attacks_player, " +
  "direct_attacks_opponent, created_at";

/** Coerces a raw Supabase row into a typed MatchRecord. */
function rowToMatchRecord(row: Record<string, unknown>): MatchRecord {
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
  const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
  return {
    user_id: str(row["user_id"]),
    player_faction: str(row["player_faction"]) as StarterFaction,
    opponent_faction: str(row["opponent_faction"]) as StarterFaction,
    winner: str(row["winner"]),
    result: str(row["result"]) as MatchRecord["result"],
    turns: num(row["turns"]),
    lives_left_player: num(row["lives_left_player"]),
    lives_left_opponent: num(row["lives_left_opponent"]),
    warriors_summoned_player: num(row["warriors_summoned_player"]),
    warriors_summoned_opponent: num(row["warriors_summoned_opponent"]),
    direct_attacks_player: num(row["direct_attacks_player"]),
    direct_attacks_opponent: num(row["direct_attacks_opponent"]),
    created_at: str(row["created_at"]),
  };
}

/** Columns selected from owned_cards; mirrors {@link OwnedCardRecord}. */
const OWNED_COLUMNS =
  "user_id, card_slug, card_name, faction, card_type, source, created_at";

/** Coerces a raw Supabase row into a typed OwnedCardRecord. */
function rowToOwnedCard(row: Record<string, unknown>): OwnedCardRecord {
  const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
  return {
    user_id: str(row["user_id"]),
    card_slug: str(row["card_slug"]),
    card_name: str(row["card_name"]),
    faction: str(row["faction"]) as OwnedCardRecord["faction"],
    card_type: str(row["card_type"]) as OwnedCardRecord["card_type"],
    source: str(row["source"]) as OwnedCardRecord["source"],
    created_at: str(row["created_at"]),
  };
}

function isStarterFaction(value: unknown): value is StarterFaction {
  return (
    typeof value === "string" &&
    (STARTER_FACTIONS as readonly string[]).includes(value)
  );
}

/** True when a Supabase signUp failed only because the user already exists. */
function isAlreadyRegistered(message: string): boolean {
  return /already (registered|been registered)|user already exists/i.test(
    message,
  );
}

/**
 * Single-form convenience for the beta: try to create the account; if it already
 * exists, sign in instead. Works against any `Auth`, so it's testable with a
 * fake backend. Returns the resulting session.
 */
export async function signUpOrSignIn(
  auth: Auth,
  email: string,
  password: string,
): Promise<AuthSession> {
  try {
    return await auth.signUp(email, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (auth.isRemote && isAlreadyRegistered(message)) {
      return auth.signIn(email, password);
    }
    throw error;
  }
}

// --- Supabase backend ------------------------------------------------------

/** Real accounts backed by Supabase Auth + the public.profiles table. */
export function createSupabaseAuth(client: SupabaseClient): Auth {
  return {
    isRemote: true,

    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      const user = data.user;
      if (user === null) {
        throw new Error("Signup did not return a user.");
      }
      return { userId: user.id, email: user.email ?? email };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return { userId: data.user.id, email: data.user.email ?? email };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (session === null) return null;
      return {
        userId: session.user.id,
        email: session.user.email ?? "",
      };
    },

    async saveFaction(session, faction) {
      const { error } = await client
        .from("profiles")
        .upsert(buildProfilePayload(session, faction), { onConflict: "id" });
      if (error) throw error;
    },

    async getProfile(session) {
      const { data, error } = await client
        .from("profiles")
        .select("id, email, selected_faction")
        .eq("id", session.userId)
        .maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      return {
        id: String(data.id),
        email: typeof data.email === "string" ? data.email : session.email,
        selected_faction: isStarterFaction(data.selected_faction)
          ? data.selected_faction
          : null,
      };
    },

    async saveMatch(_session, match) {
      // created_at is omitted: the match_history default sets it on insert.
      const { error } = await client.from("match_history").insert(match);
      if (error) throw error;
    },

    async getMatchHistory(session, limit = 50) {
      const { data, error } = await client
        .from("match_history")
        .select(MATCH_COLUMNS)
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      return rows.map(rowToMatchRecord);
    },

    async getMatchStats(session) {
      // Count rows per result with head-only queries: no rows are fetched and no
      // PostgREST row cap applies, so the totals span the whole history rather
      // than a truncated page (the bug that froze the win counter past 50 games).
      const countByResult = async (
        result: MatchRecord["result"],
      ): Promise<number> => {
        const { count, error } = await client
          .from("match_history")
          .select("*", { count: "exact", head: true })
          .eq("user_id", session.userId)
          .eq("result", result);
        if (error) throw error;
        return count ?? 0;
      };
      const [wins, losses, draws] = await Promise.all([
        countByResult("win"),
        countByResult("loss"),
        countByResult("draw"),
      ]);
      const total = wins + losses + draws;
      return { total, wins, losses, draws, winRate: total > 0 ? wins / total : 0 };
    },

    async saveReward(_session, owned, event) {
      // created_at is omitted on both: the table defaults set it on insert.
      const ownedResult = await client.from("owned_cards").insert(owned);
      if (ownedResult.error) throw ownedResult.error;
      const eventResult = await client.from("reward_events").insert(event);
      if (eventResult.error) throw eventResult.error;
      // Read-back check: confirm the just-inserted owned card is actually
      // SELECT-able. A missing/again-wrong owned_cards SELECT RLS policy lets the
      // INSERT succeed but returns ZERO rows on read (Postgres RLS denies SELECT
      // by returning nothing, not an error) — so the card silently never appears
      // in the collection or Deck Builder. Treating that as a failure makes the
      // claim queue + surfaces the retry banner with an actionable message,
      // instead of the reward vanishing. (No-op cost: one tiny query per reward.)
      const verify = await client
        .from("owned_cards")
        .select("card_slug")
        .eq("user_id", owned.user_id)
        .eq("card_slug", owned.card_slug)
        .limit(1);
      if (verify.error) throw verify.error;
      if (!verify.data || (verify.data as unknown[]).length === 0) {
        throw new Error(
          "Reward saved but could not be read back — your owned_cards SELECT " +
            "policy is likely missing. Apply the RLS SQL in apps/web/README.md.",
        );
      }
    },

    async getOwnedCards(session, limit = 200) {
      const { data, error } = await client
        .from("owned_cards")
        .select(OWNED_COLUMNS)
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      return rows.map(rowToOwnedCard);
    },

    async saveActiveDeck(_session, payload) {
      // created_at is omitted: the table default sets it on insert and it must
      // not be overwritten on update. One row per (user_id, faction).
      const { error } = await client
        .from("active_decks")
        .upsert(payload, { onConflict: "user_id,faction" });
      if (error) throw error;
    },

    async getActiveDeck(session, faction) {
      const { data, error } = await client
        .from("active_decks")
        .select("faction, cards, updated_at")
        .eq("user_id", session.userId)
        .eq("faction", faction)
        .maybeSingle();
      if (error) throw error;
      return coerceActiveDeckRow(data as Record<string, unknown> | null);
    },

    async resetProgression(session) {
      // Delete every progression row the user owns. Needs user-scoped DELETE RLS
      // policies on owned_cards / reward_events / match_history (active_decks
      // already allows delete) — see apps/web/README.md for the SQL. Each delete
      // is user-scoped; a missing policy surfaces as an error here rather than
      // silently leaving data behind.
      const tables = [
        "owned_cards",
        "reward_events",
        "match_history",
        "active_decks",
      ] as const;
      for (const table of tables) {
        const { error } = await client
          .from(table)
          .delete()
          .eq("user_id", session.userId);
        if (error) {
          throw new Error(`Reset failed on ${table}: ${error.message}`);
        }
      }
    },

    async saveFeedback(insert) {
      // created_at/id are DB defaults. RLS allows a user to insert their own
      // report (auth.uid() = user_id); see apps/web/README.md for the SQL.
      const { error } = await client.from("feedback_reports").insert(insert);
      if (error) throw error;
    },
  };
}

// --- Local (demo) backend --------------------------------------------------

/** Synthetic user id for the no-backend demo flow. */
export const LOCAL_USER_ID = "local-demo";

/** localStorage key for demo-mode feedback (no backend). */
export const LOCAL_FEEDBACK_KEY = "euphoria.feedback.v1";

/**
 * localStorage-only fallback used when Supabase isn't configured. Password is
 * accepted but not stored (there is no real auth in demo mode); the email and
 * faction reuse the existing signup module so behavior matches the old flow.
 */
export function createLocalAuth(store: KeyValueStore | null): Auth {
  // Without storage we still allow the flow, just statelessly.
  function sessionFromStore(): AuthSession | null {
    if (store === null) return null;
    const state = loadSignup(store);
    if (state === null || state.email.length === 0) return null;
    return { userId: LOCAL_USER_ID, email: state.email };
  }

  return {
    isRemote: false,

    async signUp(email, _password) {
      if (store !== null) recordSignup(store, email);
      return { userId: LOCAL_USER_ID, email: email.trim().toLowerCase() };
    },

    async signIn(email, password) {
      return this.signUp(email, password);
    },

    async signOut() {
      if (store !== null) clearSignup(store);
    },

    async getSession() {
      return sessionFromStore();
    },

    async saveFaction(_session, faction) {
      if (store !== null) recordFaction(store, faction);
    },

    async getProfile(session) {
      const faction = store !== null ? (loadSignup(store)?.faction ?? null) : null;
      return {
        id: session.userId,
        email: session.email,
        selected_faction: faction,
      };
    },

    async saveMatch(_session, match) {
      if (store !== null) appendLocalMatch(store, match);
    },

    async getMatchHistory(_session, limit) {
      if (store === null) return [];
      const all = loadLocalMatches(store).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      return limit === undefined ? all : all.slice(0, limit);
    },

    async getMatchStats(_session) {
      // Computed over EVERY stored match (no cap), mirroring the Supabase counts
      // so the two backends never diverge on the win counter / reward progress.
      if (store === null) return EMPTY_STATS;
      return computeAccountStats(loadLocalMatches(store));
    },

    async saveReward(_session, owned, event) {
      if (store !== null) {
        appendLocalOwned(store, owned);
        appendLocalRewardEvent(store, event);
      }
    },

    async getOwnedCards(_session, limit) {
      if (store === null) return [];
      const all = loadLocalOwned(store).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      return limit === undefined ? all : all.slice(0, limit);
    },

    async saveActiveDeck(_session, payload) {
      if (store !== null) {
        saveLocalActiveDeck(store, payload.faction, payload.cards);
      }
    },

    async getActiveDeck(_session, faction) {
      if (store === null) return null;
      return loadLocalActiveDeck(store, faction);
    },

    async resetProgression(_session) {
      // Clear every local progression mirror so the demo flow resets exactly as
      // the Supabase path does (the resume snapshot is cleared by the caller).
      if (store === null) return;
      store.removeItem(OWNED_STORAGE_KEY);
      store.removeItem(REWARD_EVENTS_STORAGE_KEY);
      store.removeItem(MATCH_STORAGE_KEY);
      store.removeItem(ACTIVE_DECK_STORAGE_KEY);
    },

    async saveFeedback(insert) {
      // Demo mode has no backend; append to a local log so the flow "succeeds"
      // (mirroring the other local writes). Never throws when storage is present.
      if (store === null) return;
      let all: unknown[] = [];
      const raw = store.getItem(LOCAL_FEEDBACK_KEY);
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) all = parsed;
        } catch {
          all = [];
        }
      }
      all.push({ ...insert, created_at: new Date().toISOString() });
      store.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(all));
    },
  };
}

/**
 * Returns the active Auth: Supabase when configured, else the localStorage demo.
 * The caller doesn't need to know which — only `auth.isRemote` differs.
 */
export function createAuth(): Auth {
  const client = getSupabaseClient();
  if (client !== null) return createSupabaseAuth(client);
  return createLocalAuth(getLocalStore());
}
