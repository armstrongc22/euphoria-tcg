/**
 * Account view. Shows the signed-in user's email, their selected faction and
 * chosen starter deck, match stats, win-based reward progress + owned reward
 * cards, a beta-progression placeholder, and a sign-out button.
 *
 * Split in two:
 *   - renderAccount(info, pool, onSignOut): a PURE DOM builder (no auth, no
 *     network) so the rendering can be unit-tested with jsdom.
 *   - mountAccount(container, opts): loads the session + profile + history from
 *     the Auth backend, runs test matches, and gates reward cards by win
 *     milestones (see ./reward-pacing); handles the signed-out case.
 */
import type { Card } from "@euphoria/card-data/schema";
import type { Auth } from "./auth";
import { renderMatchResult } from "./match-view";
import { runTestMatch, type MatchSummary } from "./match";
import {
  buildMatchHistoryInsert,
  computeAccountStats,
  EMPTY_STATS,
  formatWinRate,
  recentMatches,
  type AccountStats,
  type MatchRecord,
} from "./match-history";
import {
  deckCardCount,
  getRecipe,
  type StarterFaction,
} from "./starter";
import { renderRewardChoice } from "./reward-view";
import { createRng } from "@euphoria/game-engine";
import {
  buildOwnedCardInsert,
  buildRewardEventInsert,
  computeInventoryStats,
  EMPTY_INVENTORY_STATS,
  groupOwnedBySlug,
  type InventoryStats,
  type OwnedCardRecord,
  type OwnedGroup,
  type RewardTier,
} from "./rewards";
import { generateTieredRewardOptions } from "./reward-pools";
import {
  nextEnhancedMilestone,
  nextRewardMilestone,
  rewardForMatch,
} from "./reward-pacing";

/** Everything the account card needs, already resolved from the backend. */
export interface AccountInfo {
  readonly email: string;
  readonly faction: StarterFaction | null;
  /** True for a real Supabase account, false for the localStorage demo. */
  readonly isRemote: boolean;
  /** Aggregate match stats; defaults to all-zero when omitted. */
  readonly stats?: AccountStats;
  /** The most recent matches (newest first); empty when omitted. */
  readonly recent?: readonly MatchRecord[];
  /** Aggregate reward-card inventory stats; defaults to all-zero when omitted. */
  readonly inventory?: InventoryStats;
  /** Owned reward cards grouped by slug for display; empty when omitted. */
  readonly owned?: readonly OwnedGroup[];
  /** Win-based reward progress; omitted in pure-render tests that don't need it. */
  readonly rewardProgress?: RewardProgress;
}

/** Current wins and the upcoming reward milestones, for the inventory panel. */
export interface RewardProgress {
  readonly wins: number;
  readonly nextReward: number;
  readonly nextEnhanced: number;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function field(label: string, value: string, valueClass = ""): HTMLElement {
  const row = document.createElement("div");
  row.className = "account__field";
  row.innerHTML =
    `<dt class="account__label">${escapeHtml(label)}</dt>` +
    `<dd class="account__value ${valueClass}">${escapeHtml(value)}</dd>`;
  return row;
}

/** Builds the stats panel: totals, win rate, and the recent-matches list. */
function renderStats(
  stats: AccountStats,
  recent: readonly MatchRecord[],
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "account__panel account__stats";

  const heading = document.createElement("h3");
  heading.className = "account__panel-heading";
  heading.textContent = "Account stats";
  panel.append(heading);

  const list = document.createElement("dl");
  list.className = "account__fields account__stats-grid";
  list.append(field("Total matches", String(stats.total)));
  list.append(field("Wins", String(stats.wins)));
  list.append(field("Losses", String(stats.losses)));
  list.append(field("Win rate", formatWinRate(stats.winRate)));
  panel.append(list);

  const recentHeading = document.createElement("h4");
  recentHeading.className = "account__subheading";
  recentHeading.textContent = "Recent matches";
  panel.append(recentHeading);

  if (recent.length === 0) {
    const empty = document.createElement("p");
    empty.className = "account__panel-body";
    empty.textContent = "No matches yet — play a test match to get started.";
    panel.append(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "account__recent";
    for (const m of recent) {
      const li = document.createElement("li");
      li.className = `account__recent-row account__recent-row--${m.result}`;
      const verdict =
        m.result === "win" ? "Win" : m.result === "loss" ? "Loss" : "Draw";
      li.textContent =
        `${m.player_faction} vs ${m.opponent_faction} — ${verdict} · ${m.turns} turns`;
      ul.append(li);
    }
    panel.append(ul);
  }

  return panel;
}

/** Builds the reward-cards inventory panel: progress, totals, owned-card list. */
function renderInventory(
  stats: InventoryStats,
  owned: readonly OwnedGroup[],
  progress?: RewardProgress,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "account__panel account__rewards";

  const heading = document.createElement("h3");
  heading.className = "account__panel-heading";
  heading.textContent = "Reward cards";
  panel.append(heading);

  // Win-based pacing: current wins and the upcoming reward milestones. Shown
  // whether or not any cards are owned yet, so the player knows the cadence.
  if (progress !== undefined) {
    const prog = document.createElement("dl");
    prog.className = "account__fields account__stats-grid account__reward-progress";
    prog.append(field("Wins", String(progress.wins)));
    prog.append(field("Next reward", `${progress.nextReward} wins`));
    prog.append(field("Next enhanced", `${progress.nextEnhanced} wins`));
    panel.append(prog);
  }

  if (owned.length === 0) {
    const empty = document.createElement("p");
    empty.className = "account__panel-body";
    empty.textContent =
      "No reward cards yet — earn your first at 5 wins.";
    panel.append(empty);
    return panel;
  }

  const summary = document.createElement("dl");
  summary.className = "account__fields account__stats-grid";
  summary.append(field("Cards owned", String(stats.total)));
  summary.append(field("Unique cards", String(stats.unique)));
  panel.append(summary);

  const ul = document.createElement("ul");
  ul.className = "account__owned";
  for (const group of owned) {
    const li = document.createElement("li");
    li.className = "account__owned-row";
    const copies = group.count > 1 ? ` ×${group.count}` : "";
    li.textContent = `${group.name}${copies}`;
    ul.append(li);
  }
  panel.append(ul);

  return panel;
}

/**
 * Builds the account card. Pure DOM — pass a plain {@link AccountInfo}. The
 * starter-deck line is derived from the frozen recipe (./starter); recipes are
 * never regenerated here.
 */
export function renderAccount(
  info: AccountInfo,
  _pool: readonly Card[],
  onSignOut: () => void,
  /**
   * Optional: when provided AND a faction is chosen, render a "Play test match"
   * panel that calls back with the faction. Omitted in pure-render tests, so the
   * panel only appears where the caller can actually run a match.
   */
  onPlayMatch?: (faction: StarterFaction) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "account";

  const header = document.createElement("div");
  header.className = "account__header";
  header.innerHTML =
    `<p class="account__eyebrow">Euphoria TCG · Beta</p>` +
    `<h2 class="account__title">Your account</h2>` +
    `<p class="account__mode">${
      info.isRemote
        ? "Signed in to your Euphoria account."
        : "Local preview account (Supabase not configured)."
    }</p>`;
  section.append(header);

  const list = document.createElement("dl");
  list.className = "account__fields";
  list.append(field("Email", info.email || "—"));
  list.append(
    field("Selected faction", info.faction ?? "Not chosen yet"),
  );

  if (info.faction !== null) {
    const recipe = getRecipe(info.faction);
    list.append(
      field(
        "Starter deck",
        `${recipe.faction} Starter Deck · ${deckCardCount(recipe)} cards`,
      ),
    );
  } else {
    list.append(
      field("Starter deck", "Choose a deck on the Starter Decks tab"),
    );
  }
  section.append(list);

  section.append(renderStats(info.stats ?? EMPTY_STATS, info.recent ?? []));

  if (info.faction !== null && onPlayMatch !== undefined) {
    const faction = info.faction;
    const match = document.createElement("section");
    match.className = "account__panel account__match";
    match.innerHTML =
      `<h3 class="account__panel-heading">Test match</h3>` +
      `<p class="account__panel-body">Run a quick local simulation with your ` +
      `${escapeHtml(faction)} starter deck against a random AI opponent. ` +
      `Beta demo — nothing is saved yet.</p>`;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "account__play";
    play.textContent = "Play test match";
    play.addEventListener("click", () => onPlayMatch(faction));
    match.append(play);
    section.append(match);
  }

  const progression = document.createElement("section");
  progression.className = "account__panel account__progression";
  progression.innerHTML =
    `<h3 class="account__panel-heading">Beta progression</h3>` +
    `<p class="account__panel-body">Progression tracking is coming soon. ` +
    `Play games to level up your faction during the beta.</p>` +
    `<div class="account__progress" role="img" aria-label="Beta progression placeholder">` +
    `<div class="account__progress-bar" style="width: 0%"></div></div>`;
  section.append(progression);

  section.append(
    renderInventory(
      info.inventory ?? EMPTY_INVENTORY_STATS,
      info.owned ?? [],
      info.rewardProgress,
    ),
  );

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "account__signout";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", onSignOut);
  section.append(signOut);

  return section;
}

/** A short signed-out prompt shown when nobody is authenticated. */
function renderSignedOut(): HTMLElement {
  const section = document.createElement("section");
  section.className = "account account--signed-out";
  section.innerHTML =
    `<h2 class="account__title">Your account</h2>` +
    `<p class="account__panel-body">You're not signed in. ` +
    `Head to the <strong>Signup / Start</strong> tab to create your account or sign in.</p>`;
  return section;
}

/** Options for {@link mountAccount}. */
export interface AccountOptions {
  readonly auth: Auth;
  readonly pool: readonly Card[];
  /** Called after the user signs out, so the app can return to signup. */
  readonly onSignOut: () => void;
  /** Asset base path for reward-card art; defaults to "/". */
  readonly base?: string;
  /**
   * Runs one test match. Defaults to {@link runTestMatch}; injectable so tests
   * can force a win/loss outcome (match outcomes are otherwise random).
   */
  readonly runMatch?: (faction: StarterFaction) => MatchSummary;
}

/**
 * Loads the current session + profile and renders the account card into
 * `container`. Safe to call repeatedly (e.g. each time the tab is shown).
 */
export async function mountAccount(
  container: HTMLElement,
  options: AccountOptions,
): Promise<void> {
  const {
    auth,
    pool,
    onSignOut,
    base: assetBase = "/",
    runMatch = (faction) => runTestMatch({ faction, pool }),
  } = options;

  const session = await auth.getSession();
  if (session === null) {
    container.replaceChildren(renderSignedOut());
    return;
  }

  const profile = await auth.getProfile(session);
  const info0 = {
    email: profile?.email ?? session.email,
    faction: profile?.selected_faction ?? null,
    isRemote: auth.isRemote,
  } satisfies Omit<AccountInfo, "stats" | "recent" | "inventory" | "owned">;

  const handleSignOut = async (): Promise<void> => {
    try {
      await auth.signOut();
    } finally {
      onSignOut();
    }
  };

  // Match history powers the stats panel. If it can't load (Supabase down or
  // not configured), fall back to empty stats rather than crashing the page.
  const loadHistory = async (): Promise<MatchRecord[]> => {
    try {
      return await auth.getMatchHistory(session, 50);
    } catch {
      return [];
    }
  };

  // Owned reward cards power the inventory panel; same best-effort fallback.
  const loadOwned = async (): Promise<OwnedCardRecord[]> => {
    try {
      return await auth.getOwnedCards(session, 200);
    } catch {
      return [];
    }
  };

  // Claimed milestones drive reward dedup; best-effort like the rest.
  const loadClaimed = async (): Promise<number[]> => {
    try {
      return await auth.getRewardMilestones(session);
    } catch {
      return [];
    }
  };

  // Live pacing state, refreshed by showAccount and advanced as matches are
  // played, so reward decisions don't depend on read-after-write consistency.
  let knownWins = 0;
  let claimedMilestones: number[] = [];

  // A reward is due: draw 3 tier-appropriate options (seeded by the match seed)
  // and let the player claim one. Claiming writes owned_cards + reward_events
  // (best effort), marks the milestone claimed, and returns to the account.
  const showReward = (
    faction: StarterFaction,
    seed: number,
    milestone: number,
    tier: RewardTier,
  ): void => {
    const options = generateTieredRewardOptions(faction, pool, tier, createRng(seed));
    const panel = renderRewardChoice(
      options,
      { base: assetBase, tier, milestone },
      (card) => {
        claimedMilestones = [...claimedMilestones, milestone];
        void auth
          .saveReward(
            session,
            buildOwnedCardInsert(session.userId, card),
            buildRewardEventInsert(
              session.userId,
              faction,
              options,
              card,
              milestone,
              tier,
            ),
          )
          .catch(() => {
            /* persistence is best-effort; never block returning to account */
          })
          .finally(() => void showAccount());
      },
    );
    container.append(panel);
  };

  // Appends the "Next reward at X wins" note shown when no reward is due.
  const showNextRewardNote = (wins: number): void => {
    const note = document.createElement("section");
    note.className = "account__panel match-result__reward-note";
    note.innerHTML =
      `<h3 class="account__panel-heading">Reward cards</h3>` +
      `<p class="account__panel-body">Next reward at ` +
      `${nextRewardMilestone(wins)} wins.</p>`;
    container.append(note);
  };

  // The match runs entirely client-side; we persist it (best-effort), show the
  // result, then either offer a reward (at a win milestone) or the next-reward
  // note. Win count is advanced in memory so chained "Play again" stays correct.
  const showResult = (faction: StarterFaction): void => {
    const summary = runMatch(faction);
    void auth
      .saveMatch(session, buildMatchHistoryInsert(session.userId, summary))
      .catch(() => {
        /* persistence is best-effort; never block the result screen */
      });

    const winsAfter = knownWins + (summary.outcome === "win" ? 1 : 0);
    const reward = rewardForMatch({
      outcome: summary.outcome,
      totalWins: winsAfter,
      claimedMilestones,
    });
    knownWins = winsAfter;

    container.replaceChildren(
      renderMatchResult(summary, {
        onPlayAgain: () => showResult(faction),
        onBack: () => void showAccount(),
      }),
    );
    if (reward === null) {
      showNextRewardNote(winsAfter);
    } else {
      showReward(faction, summary.seed, reward.milestone, reward.tier);
    }
  };

  const showAccount = async (): Promise<void> => {
    const [records, owned, claimed] = await Promise.all([
      loadHistory(),
      loadOwned(),
      loadClaimed(),
    ]);
    const stats = computeAccountStats(records);
    knownWins = stats.wins;
    claimedMilestones = claimed;
    const info: AccountInfo = {
      ...info0,
      stats,
      recent: recentMatches(records, 5),
      inventory: computeInventoryStats(owned),
      owned: groupOwnedBySlug(owned),
      rewardProgress: {
        wins: stats.wins,
        nextReward: nextRewardMilestone(stats.wins),
        nextEnhanced: nextEnhancedMilestone(stats.wins),
      },
    };
    container.replaceChildren(
      renderAccount(info, pool, handleSignOut, showResult),
    );
  };

  await showAccount();
}
