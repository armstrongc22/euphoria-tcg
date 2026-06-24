/**
 * Reward cards: faction eligibility, option generation, the owned_cards /
 * reward_events insert payloads, inventory stats, and the localStorage
 * fallback. Pure/node — no DOM, no network.
 */
import { describe, expect, it } from "vitest";
import { createRng } from "@euphoria/game-engine";
import { cards } from "@euphoria/core/cards";
import { FACTION_SPECIFIC_ITEMS, STARTER_FACTIONS } from "@euphoria/core/starter";
import {
  appendLocalOwned,
  appendLocalRewardEvent,
  buildOwnedCardInsert,
  buildRewardEventInsert,
  computeInventoryStats,
  eligibleRewardCards,
  EMPTY_INVENTORY_STATS,
  generateRewardOptions,
  groupOwnedBySlug,
  isRewardEligible,
  loadLocalOwned,
  nextRewardMilestone,
  OWNED_STORAGE_KEY,
  REWARD_EVENTS_STORAGE_KEY,
  REWARD_OPTION_COUNT,
  rewardForMatch,
  WIN_MILESTONE_INTERVAL,
  type OwnedCardRecord,
  type RewardMilestone,
} from "../src/rewards";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const bySlug = (slug: string) => {
  const card = cards.find((c) => c.slug === slug);
  if (card === undefined) throw new Error(`Test fixture missing slug ${slug}`);
  return card;
};

describe("isRewardEligible", () => {
  it("allows the faction's own Warriors and Attacks", () => {
    for (const faction of STARTER_FACTIONS) {
      const own = cards.find(
        (c) => c.faction === faction && c.type === "Warrior",
      )!;
      expect(isRewardEligible(own, faction)).toBe(true);
    }
  });

  it("never allows Shaman cards", () => {
    const shaman = cards.find((c) => c.faction === "Shaman")!;
    for (const faction of STARTER_FACTIONS) {
      expect(isRewardEligible(shaman, faction)).toBe(false);
    }
  });

  it("never allows another faction's faction-specific cards", () => {
    const sonicWarrior = cards.find(
      (c) => c.faction === "Sonic" && c.type === "Warrior",
    )!;
    expect(isRewardEligible(sonicWarrior, "Dwarf")).toBe(false);
    expect(isRewardEligible(sonicWarrior, "Sonic")).toBe(true);
  });

  it("allows generic Neutral cards (Weapons + generic Items) for any faction", () => {
    const weapon = cards.find((c) => c.faction === "Neutral" && c.type === "Weapon")!;
    const genericItem = cards.find(
      (c) =>
        c.faction === "Neutral" &&
        c.type === "Item" &&
        FACTION_SPECIFIC_ITEMS[c.slug] === undefined,
    )!;
    for (const faction of STARTER_FACTIONS) {
      expect(isRewardEligible(weapon, faction)).toBe(true);
      expect(isRewardEligible(genericItem, faction)).toBe(true);
    }
  });

  it("restricts a faction-specific Neutral Item to its mapped faction", () => {
    // choir-of-pyrois is mapped to Monk; heavens-door-izakaya to Sonic.
    const monkItem = bySlug("choir-of-pyrois");
    expect(isRewardEligible(monkItem, "Monk")).toBe(true);
    expect(isRewardEligible(monkItem, "Sonic")).toBe(false);

    const sonicItem = bySlug("heavens-door-izakaya");
    expect(isRewardEligible(sonicItem, "Sonic")).toBe(true);
    expect(isRewardEligible(sonicItem, "Monk")).toBe(false);
  });
});

describe("eligibleRewardCards", () => {
  it("returns only eligible cards, sorted by slug, for each faction", () => {
    for (const faction of STARTER_FACTIONS) {
      const eligible = eligibleRewardCards(faction, cards);
      expect(eligible.length).toBeGreaterThan(REWARD_OPTION_COUNT);
      // Every returned card is eligible...
      expect(eligible.every((c) => isRewardEligible(c, faction))).toBe(true);
      // ...and no eligible card was dropped.
      expect(eligible.length).toBe(
        cards.filter((c) => isRewardEligible(c, faction)).length,
      );
      // Sorted by slug for determinism.
      const slugs = eligible.map((c) => c.slug);
      expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("excludes Shaman and other-faction cards", () => {
    const eligible = eligibleRewardCards("Dwarf", cards);
    expect(eligible.some((c) => c.faction === "Shaman")).toBe(false);
    expect(eligible.some((c) => c.faction === "Sonic")).toBe(false);
    expect(eligible.some((c) => c.faction === "Monk")).toBe(false);
  });
});

describe("generateRewardOptions", () => {
  it("returns 3 distinct, eligible cards", () => {
    const options = generateRewardOptions("Surfer", cards, createRng(1));
    expect(options).toHaveLength(REWARD_OPTION_COUNT);
    const slugs = new Set(options.map((c) => c.slug));
    expect(slugs.size).toBe(REWARD_OPTION_COUNT);
    expect(options.every((c) => isRewardEligible(c, "Surfer"))).toBe(true);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const a = generateRewardOptions("Monk", cards, createRng(42));
    const b = generateRewardOptions("Monk", cards, createRng(42));
    expect(a.map((c) => c.slug)).toEqual(b.map((c) => c.slug));

    // Different seeds should (with overwhelming probability) differ somewhere.
    const seeds = [1, 2, 3, 4, 5].map(
      (s) => generateRewardOptions("Monk", cards, createRng(s)).map((c) => c.slug).join(","),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("never offers a card outside the faction's eligible pool", () => {
    for (const faction of STARTER_FACTIONS) {
      const options = generateRewardOptions(faction, cards, createRng(7));
      expect(options.every((c) => isRewardEligible(c, faction))).toBe(true);
    }
  });
});

describe("reward payloads", () => {
  it("builds the owned_cards insert from a chosen card", () => {
    const card = bySlug("titan");
    const insert = buildOwnedCardInsert("user-1", card);
    expect(insert).toEqual({
      user_id: "user-1",
      card_slug: "titan",
      card_name: card.name,
      faction: card.faction,
      card_type: card.type,
      source: "reward",
    });
    // created_at is set by the DB default / local layer, not the payload.
    expect(insert).not.toHaveProperty("created_at");
  });

  it("builds the reward_events insert recording all offered options + milestone", () => {
    const options = generateRewardOptions("Dwarf", cards, createRng(3));
    const chosen = options[1]!;
    const milestone: RewardMilestone = { milestone: 10, tier: 2 };
    const event = buildRewardEventInsert("user-1", "Dwarf", options, chosen, milestone);
    expect(event).toEqual({
      user_id: "user-1",
      player_faction: "Dwarf",
      chosen_slug: chosen.slug,
      option_slugs: options.map((c) => c.slug),
      milestone: 10,
      tier: 2,
    });
    expect(event.option_slugs).toContain(event.chosen_slug);
  });
});

describe("rewardForMatch (milestone gating)", () => {
  it("offers a reward only on win milestones (every 5th win)", () => {
    expect(rewardForMatch(true, 5)).toEqual({ milestone: 5, tier: 1 });
    expect(rewardForMatch(true, 10)).toEqual({ milestone: 10, tier: 2 });
    expect(rewardForMatch(true, 30)).toEqual({ milestone: 30, tier: 6 });
  });

  it("offers nothing between milestones, even on a win", () => {
    for (const wins of [1, 2, 3, 4, 6, 7, 9, 11, 14]) {
      expect(rewardForMatch(true, wins)).toBeNull();
    }
  });

  it("never offers a reward on a loss or draw, even on a milestone win count", () => {
    // won === false covers both losses and draws.
    expect(rewardForMatch(false, 5)).toBeNull();
    expect(rewardForMatch(false, 10)).toBeNull();
    expect(rewardForMatch(false, 0)).toBeNull();
  });

  it("offers nothing at zero wins", () => {
    expect(rewardForMatch(true, 0)).toBeNull();
  });

  it("derives milestone from win count, so a null-milestone legacy row can't unlock a repeat", () => {
    // Eligibility depends only on (won, totalWins) — there is no path that reads
    // reward_events. A player with 6 career wins (one past a milestone) gets
    // nothing on their next win until they reach 10.
    expect(rewardForMatch(true, 6)).toBeNull();
    expect(rewardForMatch(true, 7)).toBeNull();
    expect(rewardForMatch(true, 10)).toEqual({ milestone: 10, tier: 2 });
  });

  it("tier is always milestone / interval", () => {
    for (let tier = 1; tier <= 8; tier++) {
      const wins = tier * WIN_MILESTONE_INTERVAL;
      expect(rewardForMatch(true, wins)).toEqual({ milestone: wins, tier });
    }
  });

  it("gates on wins only — total games played never grants progress", () => {
    // The function takes only (won, totalWins); total games is not an input, so
    // a player with 4 wins across 20 games gets nothing until their 5th WIN.
    expect(rewardForMatch(true, 4)).toBeNull(); // 5th game/loss, still 4 wins
    expect(rewardForMatch(false, 4)).toBeNull(); // a loss never progresses
    expect(rewardForMatch(true, 5)).toEqual({ milestone: 5, tier: 1 }); // 5th win
    expect(rewardForMatch(true, 6)).toBeNull(); // basic reward only on multiples
    expect(rewardForMatch(true, 10)).toEqual({ milestone: 10, tier: 2 });
    expect(rewardForMatch(true, 15)).toEqual({ milestone: 15, tier: 3 });
  });
});

describe("nextRewardMilestone (account page)", () => {
  it("always returns the next strictly-greater milestone", () => {
    expect(nextRewardMilestone(0)).toBe(5);
    expect(nextRewardMilestone(3)).toBe(5);
    expect(nextRewardMilestone(4)).toBe(5);
    // Landing on a milestone advances to the following one.
    expect(nextRewardMilestone(5)).toBe(10);
    expect(nextRewardMilestone(7)).toBe(10);
    expect(nextRewardMilestone(10)).toBe(15);
  });

  it("never returns a value at or below the current win count", () => {
    for (let wins = 0; wins <= 40; wins++) {
      expect(nextRewardMilestone(wins)).toBeGreaterThan(wins);
    }
  });
});

describe("inventory stats", () => {
  const owned = (slug: string, type: OwnedCardRecord["card_type"]) => ({
    card_slug: slug,
    card_type: type,
  });

  it("returns empty stats for no cards", () => {
    expect(computeInventoryStats([])).toEqual(EMPTY_INVENTORY_STATS);
  });

  it("counts totals, unique slugs, and per-type tallies", () => {
    const stats = computeInventoryStats([
      owned("titan", "Warrior"),
      owned("titan", "Warrior"),
      owned("fafnir", "Weapon"),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.unique).toBe(2);
    expect(stats.byType).toEqual({ Warrior: 2, Weapon: 1 });
  });

  it("groups owned rows by slug with copy counts, sorted by name", () => {
    const groups = groupOwnedBySlug([
      { card_slug: "titan", card_name: "Titan" },
      { card_slug: "fafnir", card_name: "Fafnir" },
      { card_slug: "titan", card_name: "Titan" },
    ]);
    expect(groups).toEqual([
      { slug: "fafnir", name: "Fafnir", count: 1 },
      { slug: "titan", name: "Titan", count: 2 },
    ]);
  });
});

describe("local persistence (Supabase fallback)", () => {
  it("round-trips appended owned cards", () => {
    const store = memoryStore();
    expect(loadLocalOwned(store)).toEqual([]);
    appendLocalOwned(store, buildOwnedCardInsert("u", bySlug("titan")));
    appendLocalOwned(store, buildOwnedCardInsert("u", bySlug("fafnir")));
    const all = loadLocalOwned(store);
    expect(all).toHaveLength(2);
    expect(computeInventoryStats(all)).toMatchObject({ total: 2, unique: 2 });
  });

  it("persists reward events to their own key", () => {
    const store = memoryStore();
    const options = generateRewardOptions("Sonic", cards, createRng(9));
    appendLocalRewardEvent(
      store,
      buildRewardEventInsert("u", "Sonic", options, options[0]!, {
        milestone: 5,
        tier: 1,
      }),
    );
    const raw = store.getItem(REWARD_EVENTS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].chosen_slug).toBe(options[0]!.slug);
    expect(parsed[0]).toHaveProperty("created_at");
  });

  it("returns [] on corrupt owned-cards storage rather than throwing", () => {
    const store = memoryStore();
    store.setItem(OWNED_STORAGE_KEY, "{not json");
    expect(loadLocalOwned(store)).toEqual([]);
  });
});
