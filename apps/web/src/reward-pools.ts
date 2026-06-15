/**
 * Reward pools — PURE logic, no DOM, no network. This is the explicit reward
 * metadata that lives OUTSIDE cards.json (card data is never edited): which
 * eligible cards belong to the basic pool vs. the enhanced pool, and how the 3
 * options are drawn for each tier.
 *
 * Two tiers (see ./reward-pacing for when each is granted):
 *   - "basic":    normal 5-win milestones. Draws uniformly from the faction's
 *                 eligible cards MINUS the obviously high-power / swingy ones
 *                 (HIGH_POWER_SLUGS) — so a basic reward can't hand out a
 *                 game-warping card too early.
 *   - "enhanced": 15-win milestones. Draws from the FULL eligible pool, with
 *                 high-power cards weighted up, so stronger cards are more
 *                 likely to appear (but normal cards still can).
 *
 * Faction eligibility (same-faction Warriors/Attacks, generic Neutral cards,
 * faction-mapped Neutral Items, never Shaman or off-faction cards) is reused
 * verbatim from ./rewards (eligibleRewardCards) — pools never widen it.
 *
 * No card data, starter recipes, simulator logic, or balance are touched here:
 * this only classifies the existing pool for reward purposes.
 */
import type { Card } from "@euphoria/card-data/schema";
import {
  eligibleRewardCards,
  REWARD_OPTION_COUNT,
  type RewardTier,
} from "./rewards";
import type { StarterFaction } from "./starter";

/**
 * Cards considered "obviously high-power / swingy" and therefore excluded from
 * the BASIC pool (they remain available — and weighted up — in the enhanced
 * pool). Curated explicitly; Shaman cards are omitted because they are never
 * reward-eligible anyway. Grouped by why they qualify:
 *
 *   - Hard removal / board damage (the swingiest effects in the set).
 *   - Top-end stat Warriors (≥3000 ATTACK or ≥8000 HEALTH, non-Shaman).
 *   - Premium Neutral Weapons (large unconditional stat swings).
 */
export const HIGH_POWER_SLUGS: ReadonlySet<string> = new Set<string>([
  // Hard removal / board damage
  "megawatt-apocalypse", // Destroy 1 opposing Warrior (Sonic)
  "guatavita", // Destroy 1 opposing Warrior (Dwarf)
  "dantes-lamentation", // Destroy 1 opposing Warrior (Monk)
  "cytotoxic-chapel", // 1500 damage to all opposing Warriors (Sonic)
  "7th-plague", // 1000 damage to all opposing Warriors (Monk)
  "apex-forest", // Hit one + splash all others (Dwarf)
  "serfs-bondage", // 1000 damage to up to 2 opposing Warriors (Surfer)
  "silurian-period", // 500 damage to each opposing Warrior (Dwarf)
  // Top-end stat Warriors (non-Shaman)
  "atlas-alacapati", // Dwarf 3000 / 7500
  "kaltvatten", // Surfer 3000 / 6500
  "brut", // Sonic 3000 / 5500
  "durga-highstone", // Dwarf 2100 / 8500
  "high-councilor-jerome-baldwin", // Sonic 1700 / 10000
  "freia-renvatten", // Surfer 1850 / 10000
  // Premium Neutral Weapons
  "fairys-treasure-chest", // +1000 ATTACK and +1000 HEALTH
  "jesus", // +1000 ATTACK and counter damage
  "ontology", // negate 1 attack per turn
  "armageddon", // +250 ATTACK per destroyed Warrior (scales)
]);

/** Weight multiplier for high-power cards when drawing an ENHANCED reward. */
export const ENHANCED_HIGH_POWER_WEIGHT = 3;

/** True when `card` is on the curated high-power list. */
export function isHighPower(card: Card): boolean {
  return HIGH_POWER_SLUGS.has(card.slug);
}

/** Basic pool: faction-eligible cards minus the high-power ones. */
export function basicRewardPool(
  faction: StarterFaction,
  pool: readonly Card[],
): Card[] {
  return eligibleRewardCards(faction, pool).filter((c) => !isHighPower(c));
}

/** Enhanced pool: the full faction-eligible set (high-power included). */
export function enhancedRewardPool(
  faction: StarterFaction,
  pool: readonly Card[],
): Card[] {
  return eligibleRewardCards(faction, pool);
}

/** The candidate pool for a tier (both already sorted by slug, deterministic). */
export function rewardPoolForTier(
  tier: RewardTier,
  faction: StarterFaction,
  pool: readonly Card[],
): Card[] {
  return tier === "enhanced"
    ? enhancedRewardPool(faction, pool)
    : basicRewardPool(faction, pool);
}

/** The draw weight of a card for a tier (high-power is up-weighted in enhanced). */
function weightOf(card: Card, tier: RewardTier): number {
  return tier === "enhanced" && isHighPower(card)
    ? ENHANCED_HIGH_POWER_WEIGHT
    : 1;
}

/** Picks an index from `weights` by weighted random; rng() is in [0, 1). */
function pickWeightedIndex(weights: readonly number[], rng: () => number): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1; // fallback for floating-point edge
}

/**
 * Draws `count` distinct reward options for `faction` at `tier`. Deterministic
 * for a given rng. Basic is a uniform draw from the basic pool; enhanced is a
 * weighted draw (high-power up-weighted) from the full eligible pool — both
 * without replacement. Returns fewer than `count` only if the pool is smaller
 * (it never is for the four starter factions).
 */
export function generateTieredRewardOptions(
  faction: StarterFaction,
  pool: readonly Card[],
  tier: RewardTier,
  rng: () => number,
  count: number = REWARD_OPTION_COUNT,
): Card[] {
  const candidates = rewardPoolForTier(tier, faction, pool);
  const weights = candidates.map((c) => weightOf(c, tier));
  const chosen: Card[] = [];
  const take = Math.min(count, candidates.length);
  for (let k = 0; k < take; k++) {
    const i = pickWeightedIndex(weights, rng);
    chosen.push(candidates[i]!);
    candidates.splice(i, 1);
    weights.splice(i, 1);
  }
  return chosen;
}
