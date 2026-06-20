/**
 * @vitest-environment jsdom
 *
 * End-to-end pending reward-claim flow against a fake REMOTE (Supabase-like)
 * backend: a failed reward save creates a pending claim (not an owned card), the
 * Account shows a pending banner, and a later retry syncs it into owned_cards so
 * both the Account inventory and the Deck Builder pick it up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { mountAccount } from "../src/account-view";
import { mountDeckBuilder } from "../src/deck-builder-view";
import { runTestMatch } from "../src/match";
import { PENDING_REWARD_KEY, loadPendingClaim } from "../src/pending-reward";
import type { Auth, AuthSession } from "../src/auth";
import type { OwnedCardRecord } from "../src/rewards";
import type { StarterFaction } from "../src/starter";

const SESSION: AuthSession = { userId: "remote-user", email: "p@example.com" };

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** First seed for which `faction` wins, so the played quick-sim is a win. */
function winningSeed(faction: StarterFaction): number {
  for (let seed = 1; seed < 500; seed++) {
    if (runTestMatch({ faction, pool: cards, seed }).playerWon) return seed;
  }
  throw new Error(`No winning seed for ${faction}`);
}

function forceSeed(seed: number): void {
  vi.spyOn(Math, "random").mockReturnValue((seed + 0.5) / 0x7fffffff);
}

/**
 * A minimal in-memory remote Auth. `saveReward` throws while `failSave` is true
 * (simulating an RLS/network failure), otherwise records the owned card. Reports
 * 5 lifetime wins so a played win lands on the first reward milestone.
 */
function fakeRemoteAuth(failSave: { value: boolean }) {
  const owned: OwnedCardRecord[] = [];
  const auth: Auth = {
    isRemote: true,
    signUp: async () => SESSION,
    signIn: async () => SESSION,
    signOut: async () => {},
    getSession: async () => SESSION,
    saveFaction: async () => {},
    getProfile: async () => ({
      id: SESSION.userId,
      email: SESSION.email,
      selected_faction: "Sonic",
    }),
    saveMatch: async () => {},
    getMatchHistory: async () => [],
    getMatchStats: async () => ({ total: 5, wins: 5, losses: 0, draws: 0, winRate: 1 }),
    saveReward: async (_s, ownedInsert) => {
      if (failSave.value) throw new Error("RLS denied");
      owned.push({ ...ownedInsert, created_at: new Date().toISOString() });
    },
    getOwnedCards: async () => [...owned],
    saveActiveDeck: async () => {},
    getActiveDeck: async () => null,
    resetProgression: async () => {
      owned.length = 0;
    },
  };
  return { auth, owned };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("pending reward claim — remote failure then retry sync", () => {
  it("a failed Supabase save queues a pending claim (not an owned card)", async () => {
    const failSave = { value: true };
    const { auth, owned } = fakeRemoteAuth(failSave);
    forceSeed(winningSeed("Sonic"));
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    await flush();

    // Play a (winning, milestone) quick sim and claim the offered reward.
    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    const option = container.querySelector<HTMLButtonElement>(".reward-choice__option");
    expect(option).not.toBeNull();
    option!.click();
    await flush();

    // The reward is parked as a pending claim — NOT added to owned_cards.
    expect(window.localStorage.getItem(PENDING_REWARD_KEY)).not.toBeNull();
    expect(loadPendingClaim(window.localStorage, SESSION.userId)).not.toBeNull();
    expect(owned).toHaveLength(0);
    // The account shows a clear "pending sync" banner.
    expect(container.querySelector(".account__pending-reward")).not.toBeNull();
  });

  it("retries on the next account mount and syncs once the backend recovers", async () => {
    const failSave = { value: true };
    const { auth, owned } = fakeRemoteAuth(failSave);
    forceSeed(winningSeed("Sonic"));
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    await flush();
    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    await flush();
    expect(container.querySelector(".account__pending-reward")).not.toBeNull();

    // Backend recovers; remounting the account retries the pending claim.
    failSave.value = false;
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    await flush();

    // Synced: pending cleared, the card is now a real owned card, banner gone.
    expect(loadPendingClaim(window.localStorage, SESSION.userId)).toBeNull();
    expect(owned).toHaveLength(1);
    expect(container.querySelector(".account__pending-reward")).toBeNull();
    expect(container.querySelector(".account__rewards")?.textContent).toContain(
      owned[0]!.card_name,
    );
  });

  it("the Deck Builder picks up the reward after the pending claim syncs", async () => {
    const failSave = { value: true };
    const { auth, owned } = fakeRemoteAuth(failSave);
    forceSeed(winningSeed("Sonic"));
    const accountEl = document.createElement("div");
    await mountAccount(accountEl, { auth, pool: cards, onSignOut: () => {} });
    await flush();
    accountEl.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    accountEl.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    await flush();
    expect(owned).toHaveLength(0); // still pending

    // Open the Deck Builder while the backend has recovered: its mount retries
    // the pending claim, so the synced reward card appears in the available pool.
    failSave.value = false;
    const builderEl = document.createElement("div");
    await mountDeckBuilder(builderEl, { auth, pool: cards });
    await flush();

    expect(loadPendingClaim(window.localStorage, SESSION.userId)).toBeNull();
    expect(owned).toHaveLength(1);
    const rewardName = owned[0]!.card_name;
    const builderText = builderEl.textContent ?? "";
    expect(builderText).toContain(rewardName);
  });
});
