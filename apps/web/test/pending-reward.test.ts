/**
 * Pending reward-claim QUEUE: append (no overwrite), per-(user,milestone) dedup,
 * remove-only-synced, retry-failure recording, and the syncPendingRewards pass.
 * Node — no DOM.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PENDING_REWARD_KEY,
  appendPendingClaim,
  clearPendingClaims,
  loadPendingClaims,
  pendingClaimCount,
  recordRetryFailure,
  removePendingClaim,
  syncPendingRewards,
  type PendingRewardInput,
} from "../src/pending-reward";
import type { Auth, AuthSession } from "../src/auth";
import type { OwnedCardInsert, RewardEventInsert } from "../src/rewards";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SESSION: AuthSession = { userId: "user-1", email: "p@example.com" };

function owned(slug: string): OwnedCardInsert {
  return {
    user_id: "user-1",
    card_slug: slug,
    card_name: slug.toUpperCase(),
    faction: "Dwarf",
    card_type: "Warrior",
    source: "reward",
  };
}
function event(slug: string, milestone: number): RewardEventInsert {
  return {
    user_id: "user-1",
    player_faction: "Dwarf",
    chosen_slug: slug,
    option_slugs: [slug],
    milestone,
    tier: milestone / 5,
  };
}
function input(
  slug: string,
  milestone: number,
  overrides: Partial<PendingRewardInput> = {},
): PendingRewardInput {
  return {
    userId: "user-1",
    owned: owned(slug),
    event: event(slug, milestone),
    milestone,
    cardName: slug.toUpperCase(),
    lastError: "insert failed",
    ...overrides,
  };
}

/** A remote Auth stub whose saveReward fails `failTimes` then records success. */
function remoteAuthStub(failTimes: number) {
  const saved: OwnedCardInsert[] = [];
  let calls = 0;
  const auth = {
    isRemote: true,
    saveReward: vi.fn(async (_s: AuthSession, o: OwnedCardInsert) => {
      calls += 1;
      if (calls <= failTimes) throw new Error(`fail #${calls}`);
      saved.push(o);
    }),
  } as unknown as Auth;
  return { auth, saved };
}

describe("appendPendingClaim — queue, no overwrite", () => {
  it("appends one claim", () => {
    const store = memoryStore();
    expect(appendPendingClaim(store, input("fafnir", 5))).toEqual({ status: "added" });
    const claims = loadPendingClaims(store, "user-1");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.milestone).toBe(5);
    expect(claims[0]!.id).toContain("fafnir");
  });

  it("appends a second claim WITHOUT overwriting the first", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const claims = loadPendingClaims(store, "user-1");
    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.milestone)).toEqual([5, 10]); // earliest first
    expect(pendingClaimCount(store, "user-1")).toBe(2);
  });

  it("does NOT create a duplicate claim for the same user + milestone", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5));
    const second = appendPendingClaim(store, input("griffin", 5)); // same milestone
    expect(second).toEqual({ status: "duplicate" });
    const claims = loadPendingClaims(store, "user-1");
    expect(claims).toHaveLength(1);
    // The earliest is kept.
    expect(claims[0]!.owned.card_slug).toBe("fafnir");
  });

  it("keeps the earliest when two claims share a milestone in storage", () => {
    const store = memoryStore();
    // Hand-craft a queue with two entries for milestone 5 (e.g. legacy/corruption).
    const a = { ...input("fafnir", 5), id: "a", attempts: 1, createdAt: "2026-06-21T00:00:00Z", updatedAt: "x" };
    const b = { ...input("griffin", 5), id: "b", attempts: 1, createdAt: "2026-06-21T00:05:00Z", updatedAt: "x" };
    store.setItem(PENDING_REWARD_KEY, JSON.stringify([b, a]));
    const claims = loadPendingClaims(store, "user-1");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.owned.card_slug).toBe("fafnir"); // earliest kept
  });

  it("scopes claims by user", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5, { userId: "user-1" }));
    expect(loadPendingClaims(store, "user-2")).toHaveLength(0);
  });

  it("returns error when storage write fails (no silent loss)", () => {
    const failing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {},
    };
    expect(appendPendingClaim(failing, input("fafnir", 5))).toEqual({ status: "error" });
  });
});

describe("removePendingClaim / recordRetryFailure", () => {
  it("removes only the targeted claim", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const [first] = loadPendingClaims(store, "user-1");
    removePendingClaim(store, first!.id);
    const left = loadPendingClaims(store, "user-1");
    expect(left).toHaveLength(1);
    expect(left[0]!.milestone).toBe(10);
  });

  it("records a retry failure on one claim, leaving the others untouched", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const [first, second] = loadPendingClaims(store, "user-1");
    recordRetryFailure(store, first!.id, "still offline");
    const after = loadPendingClaims(store, "user-1");
    expect(after.find((c) => c.id === first!.id)!.attempts).toBe(2);
    expect(after.find((c) => c.id === first!.id)!.lastError).toBe("still offline");
    expect(after.find((c) => c.id === second!.id)!.attempts).toBe(1);
  });

  it("clearPendingClaims removes only this user's claims", () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5, { userId: "user-1" }));
    store.setItem(
      PENDING_REWARD_KEY,
      JSON.stringify([
        ...JSON.parse(store.getItem(PENDING_REWARD_KEY)!),
        { ...input("kit", 5, { userId: "user-2" }), id: "u2", attempts: 1, createdAt: "z", updatedAt: "z" },
      ]),
    );
    clearPendingClaims(store, "user-1");
    expect(loadPendingClaims(store, "user-1")).toHaveLength(0);
    expect(loadPendingClaims(store, "user-2")).toHaveLength(1);
  });
});

describe("syncPendingRewards — one at a time", () => {
  it("is a no-op for demo/local (non-remote) accounts", async () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5));
    const local = { isRemote: false, saveReward: vi.fn() } as unknown as Auth;
    const res = await syncPendingRewards(local, SESSION, store);
    expect(res.synced).toBe(0);
    expect(local.saveReward).not.toHaveBeenCalled();
    expect(loadPendingClaims(store, "user-1")).toHaveLength(1); // intact
  });

  it("syncs all queued claims when the backend is up, removing each", async () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const { auth, saved } = remoteAuthStub(0);
    const res = await syncPendingRewards(auth, SESSION, store);
    expect(res).toEqual({ synced: 2, remaining: 0 });
    expect(saved.map((o) => o.card_slug)).toEqual(["fafnir", "titan"]);
    expect(loadPendingClaims(store, "user-1")).toHaveLength(0);
  });

  it("attempts EVERY claim each pass — an earlier failure doesn't block a later one", async () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const { auth } = remoteAuthStub(0);
    // The EARLIER claim (milestone 5) fails; the later one (milestone 10) succeeds.
    (auth.saveReward as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("RLS denied");
    });
    const res = await syncPendingRewards(auth, SESSION, store);
    // The later claim still synced this pass; only the failed one remains.
    expect(res.synced).toBe(1);
    const left = loadPendingClaims(store, "user-1");
    expect(left).toHaveLength(1);
    expect(left[0]!.milestone).toBe(5);
    expect(left[0]!.lastError).toContain("RLS denied");
    expect(left[0]!.attempts).toBe(2);
  });

  it("eventually drains the whole queue across retries as the backend recovers", async () => {
    const store = memoryStore();
    appendPendingClaim(store, input("fafnir", 5), new Date("2026-06-21T00:00:00Z"));
    appendPendingClaim(store, input("titan", 10), new Date("2026-06-21T00:01:00Z"));
    const { auth } = remoteAuthStub(1); // only the first call fails, rest succeed
    // Pass 1: claim 5 fails, claim 10 succeeds (we still try it). One left.
    const first = await syncPendingRewards(auth, SESSION, store);
    expect(first.synced).toBe(1);
    expect(first.remaining).toBe(1);
    expect(loadPendingClaims(store, "user-1")[0]!.milestone).toBe(5);
    // Pass 2: the backend is healthy now; the last claim drains.
    const second = await syncPendingRewards(auth, SESSION, store);
    expect(second.synced).toBe(1);
    expect(loadPendingClaims(store, "user-1")).toHaveLength(0);
  });
});
