/**
 * Reward → owned_cards → Deck Builder availability, and the starter-switch
 * progression reset. Exercises the local Auth backend (the Supabase fallback)
 * plus the pure availability/inventory functions. Node — no DOM.
 */
import { describe, expect, it } from "vitest";
import { cards } from "@euphoria/core/cards";
import {
  createLocalAuth,
  LOCAL_USER_ID,
  type AuthSession,
} from "../src/auth";
import {
  buildOwnedCardInsert,
  buildRewardEventInsert,
  eligibleRewardCards,
  groupOwnedBySlug,
  type RewardMilestone,
} from "@euphoria/core/rewards";
import { availableCards, starterActiveDeck } from "@euphoria/core/deck-builder";
import { resetAllProgression } from "../src/progression";
import { loadActiveMatch, saveActiveMatch } from "@euphoria/core/match-recovery";
import { appendPendingClaim, loadPendingClaims } from "../src/pending-reward";
import type { KeyValueStore } from "@euphoria/core/signup";
import type { Card } from "@euphoria/card-data/schema";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SESSION: AuthSession = { userId: LOCAL_USER_ID, email: "p@example.com" };
const MILESTONE: RewardMilestone = { milestone: 5, tier: 1 };

/** A reward card eligible for Sonic that is NOT in the Sonic starter baseline. */
function rewardCardNotInStarter(faction: "Sonic"): Card {
  const starterSlugs = new Set(starterActiveDeck(faction).map((e) => e.slug));
  const card = eligibleRewardCards(faction, cards).find(
    (c) => !starterSlugs.has(c.slug),
  );
  if (card === undefined) throw new Error("no off-starter reward card found");
  return card;
}

async function claimReward(
  auth: ReturnType<typeof createLocalAuth>,
  faction: "Sonic",
  card: Card,
): Promise<void> {
  await auth.saveReward(
    SESSION,
    buildOwnedCardInsert(SESSION.userId, card),
    buildRewardEventInsert(SESSION.userId, faction, [card], card, MILESTONE),
  );
}

describe("reward → owned_cards → Deck Builder", () => {
  it("claiming a reward saves an owned_cards row", async () => {
    const auth = createLocalAuth(memoryStore());
    const card = rewardCardNotInStarter("Sonic");
    expect(await auth.getOwnedCards(SESSION)).toHaveLength(0);
    await claimReward(auth, "Sonic", card);
    const owned = await auth.getOwnedCards(SESSION);
    expect(owned).toHaveLength(1);
    expect(owned[0]!.card_slug).toBe(card.slug);
  });

  it("Deck Builder availability includes the newly owned reward card", async () => {
    const auth = createLocalAuth(memoryStore());
    const card = rewardCardNotInStarter("Sonic");
    // Before claiming, the card is not available (not in the starter baseline).
    const before = availableCards("Sonic", cards, await auth.getOwnedCards(SESSION));
    expect(before.find((a) => a.card.slug === card.slug)).toBeUndefined();
    // After claiming, it appears as a reward-sourced available card.
    await claimReward(auth, "Sonic", card);
    const after = availableCards("Sonic", cards, await auth.getOwnedCards(SESSION));
    const entry = after.find((a) => a.card.slug === card.slug);
    expect(entry).toBeDefined();
    expect(entry!.available).toBe(1);
    expect(entry!.source).toBe("reward");
  });

  it("duplicate reward cards increase available quantity", async () => {
    const auth = createLocalAuth(memoryStore());
    const card = rewardCardNotInStarter("Sonic");
    await claimReward(auth, "Sonic", card);
    await claimReward(auth, "Sonic", card);
    const owned = await auth.getOwnedCards(SESSION);
    expect(groupOwnedBySlug(owned).find((g) => g.slug === card.slug)?.count).toBe(2);
    const avail = availableCards("Sonic", cards, owned);
    expect(avail.find((a) => a.card.slug === card.slug)!.available).toBe(2);
  });

  it("Account inventory and Deck Builder derive from the same owned source", async () => {
    const auth = createLocalAuth(memoryStore());
    const card = rewardCardNotInStarter("Sonic");
    await claimReward(auth, "Sonic", card);
    const owned = await auth.getOwnedCards(SESSION);
    // The same rows power the inventory grouping and the builder availability.
    expect(groupOwnedBySlug(owned).some((g) => g.slug === card.slug)).toBe(true);
    expect(availableCards("Sonic", cards, owned).some((a) => a.card.slug === card.slug)).toBe(
      true,
    );
  });
});

describe("resetProgression (starter switch)", () => {
  it("clears owned cards, reward events, match history, and active deck", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    const card = rewardCardNotInStarter("Sonic");
    await claimReward(auth, "Sonic", card);
    await auth.saveMatch(SESSION, {
      user_id: SESSION.userId,
      player_faction: "Sonic",
      opponent_faction: "Dwarf",
      winner: "Sonic",
      result: "win",
      turns: 10,
      lives_left_player: 3,
      lives_left_opponent: 0,
      warriors_summoned_player: 4,
      warriors_summoned_opponent: 3,
      direct_attacks_player: 3,
      direct_attacks_opponent: 0,
    });
    await auth.saveActiveDeck(SESSION, {
      user_id: SESSION.userId,
      faction: "Sonic",
      cards: starterActiveDeck("Sonic"),
      updated_at: new Date().toISOString(),
    });

    // Sanity: progression exists.
    expect(await auth.getOwnedCards(SESSION)).toHaveLength(1);
    expect((await auth.getMatchStats(SESSION)).total).toBe(1);
    expect(await auth.getActiveDeck(SESSION, "Sonic")).not.toBeNull();

    await auth.resetProgression(SESSION);

    // All progression is gone.
    expect(await auth.getOwnedCards(SESSION)).toHaveLength(0);
    expect(await auth.getMatchHistory(SESSION)).toHaveLength(0);
    expect((await auth.getMatchStats(SESSION)).total).toBe(0);
    expect((await auth.getMatchStats(SESSION)).wins).toBe(0);
    expect(await auth.getActiveDeck(SESSION, "Sonic")).toBeNull();
    expect(store.map.has("euphoria.rewardEvents.v1")).toBe(false);
  });

  it("after reset the Deck Builder shows only the starter baseline", async () => {
    const auth = createLocalAuth(memoryStore());
    const card = rewardCardNotInStarter("Sonic");
    await claimReward(auth, "Sonic", card);
    await auth.resetProgression(SESSION);
    const avail = availableCards("Sonic", cards, await auth.getOwnedCards(SESSION));
    // No reward-sourced cards remain.
    expect(avail.every((a) => a.source === "starter")).toBe(true);
    expect(avail.find((a) => a.card.slug === card.slug)).toBeUndefined();
  });
});

describe("resetAllProgression (full starter-switch reset)", () => {
  it("clears backend rows, the resume snapshot, and the pending reward queue", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    const card = rewardCardNotInStarter("Sonic");
    await claimReward(auth, "Sonic", card);
    await auth.saveActiveDeck(SESSION, {
      user_id: SESSION.userId,
      faction: "Sonic",
      cards: starterActiveDeck("Sonic"),
      updated_at: new Date().toISOString(),
    });

    // Local resume snapshot + pending reward claim (separate localStorage stores).
    const recovery = memoryStore();
    const pending = memoryStore();
    saveActiveMatch(recovery, {
      userId: SESSION.userId,
      faction: "Sonic",
      opponentFaction: "Dwarf",
      seed: 1,
      playerDeck: null,
      actions: [],
      turn: 3,
    });
    appendPendingClaim(pending, {
      userId: SESSION.userId,
      owned: buildOwnedCardInsert(SESSION.userId, card),
      event: buildRewardEventInsert(SESSION.userId, "Sonic", [card], card, MILESTONE),
      milestone: 5,
      cardName: card.name,
      lastError: "x",
    });
    // Sanity: everything is present.
    expect(await auth.getOwnedCards(SESSION)).toHaveLength(1);
    expect(loadActiveMatch(recovery, SESSION.userId)).not.toBeNull();
    expect(loadPendingClaims(pending, SESSION.userId)).toHaveLength(1);

    await resetAllProgression(auth, SESSION, { recovery, pending });

    // Backend rows gone…
    expect(await auth.getOwnedCards(SESSION)).toHaveLength(0);
    expect((await auth.getMatchStats(SESSION)).total).toBe(0);
    expect(await auth.getActiveDeck(SESSION, "Sonic")).toBeNull();
    // …and the local resume snapshot + pending queue gone too.
    expect(loadActiveMatch(recovery, SESSION.userId)).toBeNull();
    expect(loadPendingClaims(pending, SESSION.userId)).toHaveLength(0);
  });

  it("still clears local stores when the backend reset throws (best-effort)", async () => {
    const recovery = memoryStore();
    const pending = memoryStore();
    saveActiveMatch(recovery, {
      userId: SESSION.userId,
      faction: "Sonic",
      opponentFaction: "Dwarf",
      seed: 1,
      playerDeck: null,
      actions: [],
      turn: 1,
    });
    const failingAuth = {
      isRemote: true,
      resetProgression: async () => {
        throw new Error("network down");
      },
    } as unknown as Parameters<typeof resetAllProgression>[0];
    await expect(
      resetAllProgression(failingAuth, SESSION, { recovery, pending }),
    ).resolves.toBeUndefined();
    expect(loadActiveMatch(recovery, SESSION.userId)).toBeNull();
  });
});
