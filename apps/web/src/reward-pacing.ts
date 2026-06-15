/**
 * Reward pacing — PURE logic, no DOM, no network. Turns a player's saved win
 * history into "is a reward due, and which tier?" so reward cards are NOT
 * granted after every match.
 *
 * Cadence (beta):
 *   - A reward is earned only at win milestones, every WINS_PER_REWARD wins
 *     (5, 10, 15, 20, …).
 *   - Milestones that are multiples of WINS_PER_ENHANCED (15, 30, …) grant an
 *     ENHANCED reward; the rest grant a BASIC reward.
 *   - A milestone is granted at most once (dedup against already-claimed
 *     milestones, read from reward_events / its local mirror).
 *   - No reward on a loss.
 *
 * This module reads only the win COUNT and the set of claimed milestones; it
 * never touches match outcomes, card data, or balance.
 */
import type { MatchOutcome } from "./match";
import type { MatchRecord } from "./match-history";
import type { RewardTier } from "./rewards";

/** Wins between reward milestones. */
export const WINS_PER_REWARD = 5;
/** Wins between enhanced (stronger-pool) milestones. */
export const WINS_PER_ENHANCED = 15;

/** Counts winning matches in a set of rows. */
export function countWins(
  records: readonly Pick<MatchRecord, "result">[],
): number {
  let wins = 0;
  for (const r of records) if (r.result === "win") wins += 1;
  return wins;
}

/** The tier a given milestone grants: enhanced on multiples of 15, else basic. */
export function tierForMilestone(milestone: number): RewardTier {
  return milestone % WINS_PER_ENHANCED === 0 ? "enhanced" : "basic";
}

/**
 * The reward milestone a player with `wins` wins is owed but hasn't claimed, or
 * null. It is the LARGEST unclaimed multiple of WINS_PER_REWARD that is ≤ wins,
 * so a milestone missed earlier (e.g. the app closed before choosing) is still
 * granted later, while a claimed one is never granted twice.
 */
export function earnedMilestone(
  wins: number,
  claimedMilestones: readonly number[],
): number | null {
  const claimed = new Set(claimedMilestones);
  const highest = Math.floor(wins / WINS_PER_REWARD) * WINS_PER_REWARD;
  for (let m = highest; m >= WINS_PER_REWARD; m -= WINS_PER_REWARD) {
    if (!claimed.has(m)) return m;
  }
  return null;
}

/** A decided reward: which milestone it is for and which pool tier to draw. */
export interface EarnedReward {
  readonly milestone: number;
  readonly tier: RewardTier;
}

/**
 * Decides the reward for a just-finished match, or null when none is due:
 * null on a loss, null below the first milestone, and null when the owed
 * milestone has already been claimed. `totalWins` must already include this
 * match's win.
 */
export function rewardForMatch(args: {
  readonly outcome: MatchOutcome;
  readonly totalWins: number;
  readonly claimedMilestones: readonly number[];
}): EarnedReward | null {
  if (args.outcome !== "win") return null;
  const milestone = earnedMilestone(args.totalWins, args.claimedMilestones);
  if (milestone === null) return null;
  return { milestone, tier: tierForMilestone(milestone) };
}

/** The next win count at which any reward is reached (always forward of `wins`). */
export function nextRewardMilestone(wins: number): number {
  return (Math.floor(wins / WINS_PER_REWARD) + 1) * WINS_PER_REWARD;
}

/** The next win count at which an enhanced reward is reached. */
export function nextEnhancedMilestone(wins: number): number {
  return (Math.floor(wins / WINS_PER_ENHANCED) + 1) * WINS_PER_ENHANCED;
}
