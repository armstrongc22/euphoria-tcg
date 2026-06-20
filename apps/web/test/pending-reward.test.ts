/**
 * Pending reward-claim queue: save/load/clear, user scoping, retry-failure
 * recording, and the syncPendingReward retry against a backend. Node — no DOM.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PENDING_REWARD_KEY,
  clearPendingClaim,
  loadPendingClaim,
  recordRetryFailure,
  savePendingClaim,
  syncPendingReward,
  type PendingRewardInput,
} from "../src/pending-reward";
import type { Auth, AuthSession } from "../src/auth";
import type { OwnedCardInsert, RewardEventInsert } from "../src/rewards";
import type { KeyValueStore } from "../src/signup";

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
const OWNED: OwnedCardInsert = {
  user_id: "user-1",
  card_slug: "fafnir",
  card_name: "Fafnir",
  faction: "Dwarf",
  card_type: "Warrior",
  source: "reward",
};
const EVENT: RewardEventInsert = {
  user_id: "user-1",
  player_faction: "Dwarf",
  chosen_slug: "fafnir",
  option_slugs: ["fafnir"],
  milestone: 5,
  tier: 1,
};

function input(overrides: Partial<PendingRewardInput> = {}): PendingRewardInput {
  return {
    userId: "user-1",
    owned: OWNED,
    event: EVENT,
    milestone: 5,
    cardName: "Fafnir",
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
    saveReward: vi.fn(async (_s: AuthSession, owned: OwnedCardInsert) => {
      calls += 1;
      if (calls <= failTimes) throw new Error(`fail #${calls}`);
      saved.push(owned);
    }),
  } as unknown as Auth;
  return { auth, saved, calls: () => calls };
}

describe("pending-reward persistence", () => {
  it("round-trips a pending claim for the same user", () => {
    const store = memoryStore();
    expect(savePendingClaim(store, input())).toBe(true);
    const claim = loadPendingClaim(store, "user-1");
    expect(claim).not.toBeNull();
    expect(claim).toMatchObject({
      userId: "user-1",
      milestone: 5,
      cardName: "Fafnir",
      attempts: 1,
    });
    expect(claim!.owned.card_slug).toBe("fafnir");
  });

  it("does not return another user's claim", () => {
    const store = memoryStore();
    savePendingClaim(store, input({ userId: "user-1" }));
    expect(loadPendingClaim(store, "user-2")).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    const store = memoryStore();
    store.setItem(PENDING_REWARD_KEY, "{not json");
    expect(loadPendingClaim(store, "user-1")).toBeNull();
  });

  it("records retry failures without discarding the claim", () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    recordRetryFailure(store, "user-1", "still offline");
    const claim = loadPendingClaim(store, "user-1");
    expect(claim!.attempts).toBe(2);
    expect(claim!.lastError).toBe("still offline");
  });

  it("clearPendingClaim removes it", () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    clearPendingClaim(store);
    expect(loadPendingClaim(store, "user-1")).toBeNull();
  });

  it("returns false when storage write fails (hard failure, not silent loss)", () => {
    const failing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {},
    };
    expect(savePendingClaim(failing, input())).toBe(false);
  });
});

describe("syncPendingReward", () => {
  it("is a no-op for demo/local (non-remote) accounts", async () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    const local = { isRemote: false, saveReward: vi.fn() } as unknown as Auth;
    expect(await syncPendingReward(local, SESSION, store)).toBe(false);
    expect(local.saveReward).not.toHaveBeenCalled();
    // The claim is left intact (only Supabase accounts queue/sync).
    expect(loadPendingClaim(store, "user-1")).not.toBeNull();
  });

  it("returns false when there is nothing pending", async () => {
    const store = memoryStore();
    const { auth } = remoteAuthStub(0);
    expect(await syncPendingReward(auth, SESSION, store)).toBe(false);
  });

  it("syncs a pending claim on a successful retry and clears it", async () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    const { auth, saved } = remoteAuthStub(0); // succeeds immediately
    const ok = await syncPendingReward(auth, SESSION, store);
    expect(ok).toBe(true);
    expect(saved.map((o) => o.card_slug)).toEqual(["fafnir"]);
    expect(loadPendingClaim(store, "user-1")).toBeNull();
  });

  it("keeps the claim and records the error when a retry fails", async () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    const { auth } = remoteAuthStub(5); // keeps failing
    const ok = await syncPendingReward(auth, SESSION, store);
    expect(ok).toBe(false);
    const claim = loadPendingClaim(store, "user-1");
    expect(claim).not.toBeNull();
    expect(claim!.attempts).toBe(2);
    expect(claim!.lastError).toContain("fail #1");
  });

  it("eventually syncs once the backend recovers", async () => {
    const store = memoryStore();
    savePendingClaim(store, input());
    const { auth } = remoteAuthStub(1); // fails once, then succeeds
    expect(await syncPendingReward(auth, SESSION, store)).toBe(false);
    expect(loadPendingClaim(store, "user-1")).not.toBeNull();
    expect(await syncPendingReward(auth, SESSION, store)).toBe(true);
    expect(loadPendingClaim(store, "user-1")).toBeNull();
  });
});
