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
import { getSupabaseClient } from "./supabase-client";
import {
  clearSignup,
  getLocalStore,
  loadSignup,
  recordFaction,
  recordSignup,
  type KeyValueStore,
} from "./signup";
import { STARTER_FACTIONS, type StarterFaction } from "./starter";

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
  };
}

// --- Local (demo) backend --------------------------------------------------

/** Synthetic user id for the no-backend demo flow. */
export const LOCAL_USER_ID = "local-demo";

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
