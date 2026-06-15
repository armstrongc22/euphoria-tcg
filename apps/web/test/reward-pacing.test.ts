/**
 * Reward pacing: win counting, milestone math, tier selection, and the
 * loss/below-milestone/duplicate eligibility gates. Pure/node — no DOM.
 */
import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../src/match-history";
import {
  countWins,
  earnedMilestone,
  nextEnhancedMilestone,
  nextRewardMilestone,
  rewardForMatch,
  tierForMilestone,
} from "../src/reward-pacing";

const result = (r: MatchRecord["result"]): Pick<MatchRecord, "result"> => ({
  result: r,
});

describe("countWins", () => {
  it("counts only winning rows", () => {
    expect(
      countWins([result("win"), result("loss"), result("win"), result("draw")]),
    ).toBe(2);
    expect(countWins([])).toBe(0);
  });
});

describe("tierForMilestone", () => {
  it("is enhanced on multiples of 15, basic otherwise", () => {
    expect(tierForMilestone(5)).toBe("basic");
    expect(tierForMilestone(10)).toBe("basic");
    expect(tierForMilestone(15)).toBe("enhanced");
    expect(tierForMilestone(20)).toBe("basic");
    expect(tierForMilestone(25)).toBe("basic");
    expect(tierForMilestone(30)).toBe("enhanced");
    expect(tierForMilestone(45)).toBe("enhanced");
  });
});

describe("earnedMilestone", () => {
  it("returns null below the first milestone (0–4 wins)", () => {
    for (let w = 0; w <= 4; w++) expect(earnedMilestone(w, [])).toBeNull();
  });

  it("returns the milestone exactly at a multiple of 5", () => {
    expect(earnedMilestone(5, [])).toBe(5);
    expect(earnedMilestone(10, [])).toBe(10);
    expect(earnedMilestone(15, [])).toBe(15);
  });

  it("returns the highest unclaimed milestone at or below the win count", () => {
    // At 7 wins with 5 already claimed, nothing new is due.
    expect(earnedMilestone(7, [5])).toBeNull();
    // At 12 wins with 5 and 10 claimed, nothing new is due.
    expect(earnedMilestone(12, [5, 10])).toBeNull();
    // A milestone missed earlier is still granted later.
    expect(earnedMilestone(12, [10])).toBe(5);
  });

  it("never re-grants a claimed milestone", () => {
    expect(earnedMilestone(5, [5])).toBeNull();
    expect(earnedMilestone(10, [5, 10])).toBeNull();
  });
});

describe("rewardForMatch", () => {
  it("grants no reward on a loss, even at a milestone win count", () => {
    expect(
      rewardForMatch({ outcome: "loss", totalWins: 5, claimedMilestones: [] }),
    ).toBeNull();
    expect(
      rewardForMatch({ outcome: "draw", totalWins: 15, claimedMilestones: [] }),
    ).toBeNull();
  });

  it("grants no reward below the first milestone", () => {
    for (let w = 0; w <= 4; w++) {
      expect(
        rewardForMatch({ outcome: "win", totalWins: w, claimedMilestones: [] }),
      ).toBeNull();
    }
  });

  it("grants a basic reward at 5/10/20/25 wins", () => {
    for (const w of [5, 10, 20, 25]) {
      const claimed = [5, 10, 15, 20, 25].filter((m) => m < w);
      expect(
        rewardForMatch({ outcome: "win", totalWins: w, claimedMilestones: claimed }),
      ).toEqual({ milestone: w, tier: "basic" });
    }
  });

  it("grants an enhanced reward at 15/30 wins", () => {
    expect(
      rewardForMatch({
        outcome: "win",
        totalWins: 15,
        claimedMilestones: [5, 10],
      }),
    ).toEqual({ milestone: 15, tier: "enhanced" });
    expect(
      rewardForMatch({
        outcome: "win",
        totalWins: 30,
        claimedMilestones: [5, 10, 15, 20, 25],
      }),
    ).toEqual({ milestone: 30, tier: "enhanced" });
  });

  it("does not grant a duplicate reward for the same milestone", () => {
    expect(
      rewardForMatch({ outcome: "win", totalWins: 5, claimedMilestones: [5] }),
    ).toBeNull();
  });

  it("walks the example sequence 5→30 with the expected tiers", () => {
    const claimed: number[] = [];
    const seq: Array<{ wins: number; tier: string }> = [];
    for (let wins = 1; wins <= 30; wins++) {
      const r = rewardForMatch({ outcome: "win", totalWins: wins, claimedMilestones: claimed });
      if (r !== null) {
        claimed.push(r.milestone);
        seq.push({ wins, tier: r.tier });
      }
    }
    expect(seq).toEqual([
      { wins: 5, tier: "basic" },
      { wins: 10, tier: "basic" },
      { wins: 15, tier: "enhanced" },
      { wins: 20, tier: "basic" },
      { wins: 25, tier: "basic" },
      { wins: 30, tier: "enhanced" },
    ]);
  });
});

describe("next milestone helpers", () => {
  it("nextRewardMilestone always points forward", () => {
    expect(nextRewardMilestone(0)).toBe(5);
    expect(nextRewardMilestone(3)).toBe(5);
    expect(nextRewardMilestone(5)).toBe(10);
    expect(nextRewardMilestone(12)).toBe(15);
  });

  it("nextEnhancedMilestone steps by 15", () => {
    expect(nextEnhancedMilestone(0)).toBe(15);
    expect(nextEnhancedMilestone(14)).toBe(15);
    expect(nextEnhancedMilestone(15)).toBe(30);
    expect(nextEnhancedMilestone(29)).toBe(30);
  });
});
