/**
 * Reward pools: basic vs. enhanced pool membership, faction eligibility (incl.
 * no Shaman / no off-faction cards), high-power exclusion from basic, and
 * tiered option generation. Pure/node — no DOM.
 */
import { describe, expect, it } from "vitest";
import { createRng } from "@euphoria/game-engine";
import { cards } from "../src/cards";
import { isRewardEligible } from "../src/rewards";
import { STARTER_FACTIONS } from "../src/starter";
import {
  basicRewardPool,
  enhancedRewardPool,
  generateTieredRewardOptions,
  HIGH_POWER_SLUGS,
  isHighPower,
} from "../src/reward-pools";

describe("HIGH_POWER_SLUGS", () => {
  it("references only real, non-Shaman cards", () => {
    for (const slug of HIGH_POWER_SLUGS) {
      const card = cards.find((c) => c.slug === slug);
      expect(card, `unknown high-power slug ${slug}`).toBeDefined();
      expect(card!.faction).not.toBe("Shaman");
    }
  });
});

describe("basicRewardPool", () => {
  it("excludes high-power cards and keeps faction eligibility", () => {
    for (const faction of STARTER_FACTIONS) {
      const basic = basicRewardPool(faction, cards);
      expect(basic.length).toBeGreaterThan(3);
      expect(basic.some((c) => isHighPower(c))).toBe(false);
      expect(basic.every((c) => isRewardEligible(c, faction))).toBe(true);
    }
  });

  it("never includes Shaman or off-faction cards", () => {
    const basic = basicRewardPool("Dwarf", cards);
    expect(basic.some((c) => c.faction === "Shaman")).toBe(false);
    expect(basic.some((c) => c.faction === "Sonic")).toBe(false);
    expect(basic.some((c) => c.faction === "Monk")).toBe(false);
  });
});

describe("enhancedRewardPool", () => {
  it("includes high-power cards while keeping faction eligibility", () => {
    const enhanced = enhancedRewardPool("Dwarf", cards);
    // Dwarf-eligible high-power cards (e.g. atlas-alacapati) are present.
    expect(enhanced.some((c) => isHighPower(c))).toBe(true);
    expect(enhanced.every((c) => isRewardEligible(c, "Dwarf"))).toBe(true);
    expect(enhanced.some((c) => c.faction === "Shaman")).toBe(false);
  });

  it("is a superset of the basic pool", () => {
    for (const faction of STARTER_FACTIONS) {
      const basic = new Set(basicRewardPool(faction, cards).map((c) => c.slug));
      const enhanced = new Set(enhancedRewardPool(faction, cards).map((c) => c.slug));
      for (const slug of basic) expect(enhanced.has(slug)).toBe(true);
      expect(enhanced.size).toBeGreaterThan(basic.size);
    }
  });
});

describe("generateTieredRewardOptions", () => {
  it("draws 3 distinct basic options that avoid high-power cards", () => {
    const options = generateTieredRewardOptions("Surfer", cards, "basic", createRng(1));
    expect(options).toHaveLength(3);
    expect(new Set(options.map((c) => c.slug)).size).toBe(3);
    expect(options.some((c) => isHighPower(c))).toBe(false);
    expect(options.every((c) => isRewardEligible(c, "Surfer"))).toBe(true);
  });

  it("draws enhanced options from the full eligible pool, deterministically", () => {
    const a = generateTieredRewardOptions("Monk", cards, "enhanced", createRng(7));
    const b = generateTieredRewardOptions("Monk", cards, "enhanced", createRng(7));
    expect(a.map((c) => c.slug)).toEqual(b.map((c) => c.slug));
    expect(a).toHaveLength(3);
    expect(a.every((c) => isRewardEligible(c, "Monk"))).toBe(true);
  });

  it("enhanced surfaces high-power cards more often than basic (which never does)", () => {
    let basicHigh = 0;
    let enhancedHigh = 0;
    for (let seed = 0; seed < 200; seed++) {
      basicHigh += generateTieredRewardOptions("Dwarf", cards, "basic", createRng(seed))
        .filter(isHighPower).length;
      enhancedHigh += generateTieredRewardOptions("Dwarf", cards, "enhanced", createRng(seed))
        .filter(isHighPower).length;
    }
    expect(basicHigh).toBe(0);
    expect(enhancedHigh).toBeGreaterThan(0);
  });
});
