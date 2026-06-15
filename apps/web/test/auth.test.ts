/**
 * Auth layer: the profile upsert payload, the localStorage demo fallback, and
 * the signUp-or-signIn helper. Pure/node — no DOM and no network (the Supabase
 * backend is covered by exercising the shared helper against a fake Auth).
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildProfilePayload,
  createLocalAuth,
  signUpOrSignIn,
  LOCAL_USER_ID,
  type Auth,
  type AuthSession,
} from "../src/auth";
import { loadSignup, type KeyValueStore } from "../src/signup";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SESSION: AuthSession = { userId: "user-1", email: "player@example.com" };

describe("buildProfilePayload", () => {
  it("includes id, email, faction, and updated_at (no created_at)", () => {
    const payload = buildProfilePayload(
      SESSION,
      "Sonic",
      new Date("2026-06-15T00:00:00Z"),
    );
    expect(payload).toEqual({
      id: "user-1",
      email: "player@example.com",
      selected_faction: "Sonic",
      updated_at: "2026-06-15T00:00:00.000Z",
    });
    expect(payload).not.toHaveProperty("created_at");
  });
});

describe("createLocalAuth (fallback)", () => {
  it("is not remote", () => {
    expect(createLocalAuth(memoryStore()).isRemote).toBe(false);
  });

  it("persists email on signUp and restores it as a session", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);

    const session = await auth.signUp("Player@Example.com", "pw");
    expect(session).toEqual({ userId: LOCAL_USER_ID, email: "player@example.com" });
    expect(loadSignup(store)?.email).toBe("player@example.com");

    expect(await auth.getSession()).toEqual(session);
  });

  it("saves the chosen faction onto the profile", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");

    await auth.saveFaction(SESSION, "Surfer");
    const profile = await auth.getProfile({
      userId: LOCAL_USER_ID,
      email: "player@example.com",
    });
    expect(profile?.selected_faction).toBe("Surfer");
  });

  it("clears the session on signOut", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");

    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it("works statelessly with no store (degraded mode)", async () => {
    const auth = createLocalAuth(null);
    const session = await auth.signUp("player@example.com", "pw");
    expect(session.email).toBe("player@example.com");
    // Nothing is persisted, so there is no restorable session.
    expect(await auth.getSession()).toBeNull();
    // saveFaction / signOut must not throw without a store.
    await expect(auth.saveFaction(session, "Monk")).resolves.toBeUndefined();
    await expect(auth.signOut()).resolves.toBeUndefined();
  });
});

describe("signUpOrSignIn", () => {
  it("returns the signUp session on a fresh account", async () => {
    const auth: Auth = {
      isRemote: true,
      signUp: vi.fn(async () => SESSION),
      signIn: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      saveFaction: vi.fn(),
      getProfile: vi.fn(),
    };
    expect(await signUpOrSignIn(auth, SESSION.email, "pw")).toEqual(SESSION);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("falls back to signIn when the remote user already exists", async () => {
    const auth: Auth = {
      isRemote: true,
      signUp: vi.fn(async () => {
        throw new Error("User already registered");
      }),
      signIn: vi.fn(async () => SESSION),
      signOut: vi.fn(),
      getSession: vi.fn(),
      saveFaction: vi.fn(),
      getProfile: vi.fn(),
    };
    expect(await signUpOrSignIn(auth, SESSION.email, "pw")).toEqual(SESSION);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-'already registered' errors instead of signing in", async () => {
    const auth: Auth = {
      isRemote: true,
      signUp: vi.fn(async () => {
        throw new Error("Password should be at least 6 characters");
      }),
      signIn: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      saveFaction: vi.fn(),
      getProfile: vi.fn(),
    };
    await expect(signUpOrSignIn(auth, SESSION.email, "pw")).rejects.toThrow(
      /at least 6 characters/,
    );
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});
