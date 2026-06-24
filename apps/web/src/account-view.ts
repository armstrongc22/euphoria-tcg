/**
 * Account view. Shows the signed-in user's email, their selected faction and
 * chosen starter deck, placeholders for beta progression and reward cards, and a
 * sign-out button.
 *
 * Split in two:
 *   - renderAccount(info, pool, onSignOut): a PURE DOM builder (no auth, no
 *     network) so the rendering can be unit-tested with jsdom.
 *   - mountAccount(container, opts): loads the session + profile from the Auth
 *     backend and renders into the container; handles the signed-out case.
 */
import type { Card } from "@euphoria/card-data/schema";
import type { Auth } from "./auth";
import { describeError } from "@euphoria/core/errors";
import { renderMatchResult } from "./match-view";
import { runTestMatch, type MatchSummary } from "@euphoria/core/match";
import { createPlayableMatch, ReplayError, type PlayableMatch } from "@euphoria/core/play-match";
import { renderPlayableMatch, type PlayableMatchBoard } from "./play-match-view";
import { createCardDetail } from "./detail";
import {
  clearActiveMatch,
  getRecoveryStore,
  loadActiveMatch,
  saveActiveMatch,
  snapshotInfo,
  type SavedMatch,
} from "@euphoria/core/match-recovery";
import { logDebug, noteSnapshotSaved } from "@euphoria/core/debug-log";
import { noSnapshot, snapshotThrottleMs } from "./debug-flags";
import { createDebugPanel } from "./debug-panel";
import {
  buildMatchHistoryInsert,
  EMPTY_STATS,
  formatWinRate,
  recentMatches,
  type AccountStats,
  type MatchRecord,
} from "@euphoria/core/match-history";
import {
  deckCardCount,
  getRecipe,
  type StarterFaction,
} from "@euphoria/core/starter";
import { chooseActiveDeck, type ChosenActiveDeck } from "@euphoria/core/deck-builder";
import { renderRewardModal, type RewardClaimResult } from "./reward-view";
import {
  appendPendingClaim,
  getPendingStore,
  loadPendingClaims,
  syncPendingRewards,
  type PendingRewardClaim,
} from "./pending-reward";
import { getTutorialStore, resetTutorial, type NextStep } from "@euphoria/core/tutorial";
import { openFeedbackModal } from "./feedback-view";
import {
  getFeedbackStore,
  loadPendingFeedback,
  pendingFeedbackCount,
  syncPendingFeedback,
} from "./feedback";
import {
  buildChecklist,
  hasOnboardingProgress,
  isOnboardingDismissed,
  markOnboardingProgress,
  setOnboardingDismissed,
  type ChecklistItem,
} from "@euphoria/core/onboarding-checklist";
import { renderChecklistCard, renderShowGuide } from "./onboarding-checklist-view";
import { createRng } from "@euphoria/game-engine";
import {
  buildOwnedCardInsert,
  buildRewardEventInsert,
  computeInventoryStats,
  EMPTY_INVENTORY_STATS,
  generateRewardOptions,
  groupOwnedBySlug,
  nextRewardMilestone,
  rewardForMatch,
  type InventoryStats,
  type OwnedCardRecord,
  type OwnedGroup,
  type RewardMilestone,
} from "@euphoria/core/rewards";

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
  /** Which deck is active: a saved custom deck or the fixed starter deck. */
  readonly deckMode?: "Starter Deck" | "Custom Deck";
  /** A note shown when a saved deck was invalid and we fell back to the starter. */
  readonly deckNote?: string;
  /** Contextual onboarding "next step" hint (Feature C); omitted = no card. */
  readonly nextStep?: NextStep;
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
  const next = nextRewardMilestone(stats.wins);
  list.append(
    field("Next reward", `Win ${next} (${next - stats.wins} to go)`),
  );
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

/** Builds the reward-cards inventory panel: totals plus the owned-card list. */
function renderInventory(
  stats: InventoryStats,
  owned: readonly OwnedGroup[],
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "account__panel account__rewards";

  const heading = document.createElement("h3");
  heading.className = "account__panel-heading";
  heading.textContent = "Reward cards";
  panel.append(heading);

  if (owned.length === 0) {
    const empty = document.createElement("p");
    empty.className = "account__panel-body";
    empty.textContent =
      "No reward cards yet — play a test match to earn your first reward.";
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
  /**
   * Optional: when provided AND a faction is chosen, render a "Play match"
   * button that launches the interactive, human-controlled match (./play-match).
   * Like onPlayMatch it is omitted in pure-render tests.
   */
  onPlayLive?: (faction: StarterFaction) => void,
  /**
   * Optional: invoked when the onboarding next-step card's CTA is clicked, with
   * the step so the mount can route (Play match / Deck Builder / Starter Decks).
   */
  onNextStep?: (step: NextStep) => void,
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

  // Onboarding "Next step" card (Feature C): a single contextual nudge.
  if (info.nextStep !== undefined) {
    const step = info.nextStep;
    const card = document.createElement("section");
    card.className = "account__panel account__nextstep";
    card.dataset.step = step.id;
    const h = document.createElement("h3");
    h.className = "account__panel-heading";
    h.textContent = "Next step";
    const body = document.createElement("p");
    body.className = "account__panel-body";
    body.textContent = step.body;
    card.append(h, body);
    if (step.cta !== undefined && onNextStep !== undefined) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "account__play account__nextstep-cta";
      btn.textContent = step.cta;
      btn.addEventListener("click", () => onNextStep(step));
      card.append(btn);
    }
    section.append(card);
  }

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
    list.append(
      field(
        "Active deck",
        info.deckMode ?? "Starter Deck",
        info.deckMode === "Custom Deck" ? "account__value--custom" : "",
      ),
    );
  } else {
    list.append(
      field("Starter deck", "Choose a deck on the Starter Decks tab"),
    );
  }
  section.append(list);

  if (info.deckNote !== undefined) {
    const note = document.createElement("p");
    note.className = "account__deck-note";
    note.textContent = info.deckNote;
    section.append(note);
  }

  section.append(renderStats(info.stats ?? EMPTY_STATS, info.recent ?? []));

  if (info.faction !== null && (onPlayMatch !== undefined || onPlayLive !== undefined)) {
    const faction = info.faction;
    const match = document.createElement("section");
    match.className = "account__panel account__match";
    match.innerHTML =
      `<h3 class="account__panel-heading">Test match</h3>` +
      `<p class="account__panel-body">Play a match with your ` +
      `${escapeHtml(faction)} active deck against a random AI opponent. ` +
      `Beta demo.</p>`;
    if (onPlayLive !== undefined) {
      const playLive = document.createElement("button");
      playLive.type = "button";
      playLive.className = "account__play account__play--live";
      playLive.textContent = "Play match";
      playLive.addEventListener("click", () => onPlayLive(faction));
      match.append(playLive);
    }
    if (onPlayMatch !== undefined) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "account__play account__play--sim";
      play.textContent = "Quick sim";
      play.addEventListener("click", () => onPlayMatch(faction));
      match.append(play);
    }
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
    renderInventory(info.inventory ?? EMPTY_INVENTORY_STATS, info.owned ?? []),
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
   * When set to the signed-in user's faction, mount straight into the
   * interactive match (e.g. arriving from the Deck Builder's "Play match")
   * instead of the account card. Ignored if it doesn't match the profile.
   */
  readonly autoPlay?: StarterFaction;
  /**
   * Optional tab navigation, so the onboarding next-step CTA can send the player
   * to the Starter Decks or Deck Builder tab (the app owns the tabs).
   */
  readonly onNavigate?: (tab: "starter" | "deckbuilder") => void;
}

/**
 * Loads the current session + profile and renders the account card into
 * `container`. Safe to call repeatedly (e.g. each time the tab is shown).
 */
export async function mountAccount(
  container: HTMLElement,
  options: AccountOptions,
): Promise<void> {
  const { auth, pool, onSignOut, base: assetBase = "/" } = options;

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

  // The live match board, when one is mounted. Swapping the main view disposes
  // it first so its opponent-playback timer can't fire into a detached board.
  let activeBoard: PlayableMatchBoard | null = null;
  const swapMain = (...nodes: Node[]): void => {
    activeBoard?.dispose();
    activeBoard = null;
    container.replaceChildren(...nodes);
  };

  // Crash/refresh recovery: persist the in-progress live match (seed + deck +
  // action history) to localStorage after each move, so a mobile tab reload
  // mid-match can offer "Resume". Best-effort — null when storage is unavailable.
  const recoveryStore = getRecoveryStore();

  // Pending reward-claim queue (Supabase accounts only): when a reward save fails
  // we park it here and retry on each account mount, rather than losing it or
  // pretending it saved. Supabase stays the single owned-cards source of truth.
  const pendingStore = getPendingStore();
  // Tutorial dismissal flags (local only, beta) — backs "Reset tutorial tips".
  const tutorialStore = getTutorialStore();
  // Unsent feedback queue (Feature F): parked reports awaiting retry.
  const feedbackStore = getFeedbackStore();
  // Getting Started card: expanded is session/mount-scoped (compact by default on
  // each visit); the "hidden" state persists in localStorage (isOnboardingDismissed).
  let onboardingExpanded = false;
  // The active match + deck, tracked so the debug panel can force-save on demand.
  let activeMatch: PlayableMatch | null = null;
  let activeChosen: ChosenActiveDeck | null = null;
  let lastSnapshotAt = 0;
  // Set when a resume failed validation, shown once on the next account render.
  let invalidResumeMessage: string | null = null;
  // The current top-level state, for the debug panel's "view" field.
  let currentView = "account";

  // Persists the active match. Throttled (Feature F.3) so rapid actions don't
  // hammer localStorage; `force` bypasses the throttle (Feature D.3). Disabled
  // entirely under euphoriaNoSnapshot (isolates write pressure). A failed write
  // (quota/blocked) is surfaced via diagnostics rather than crashing.
  const persistMatch = (
    match: PlayableMatch,
    chosen: ChosenActiveDeck,
    force = false,
  ): boolean => {
    activeMatch = match;
    activeChosen = chosen;
    if (recoveryStore === null) return false;
    if (noSnapshot()) {
      logDebug("snapshotSkipped", { reason: "euphoriaNoSnapshot" });
      return false;
    }
    const now = Date.now();
    if (!force && now - lastSnapshotAt < snapshotThrottleMs()) return false;
    lastSnapshotAt = now;
    const ok = saveActiveMatch(recoveryStore, {
      userId: session.userId,
      faction: match.playerFaction,
      opponentFaction: match.opponentFaction,
      seed: match.seed,
      playerDeck: chosen.isCustom ? [...chosen.entries] : null,
      actions: match.history(),
      turn: match.state().turn,
    });
    if (ok) noteSnapshotSaved();
    else logDebug("snapshotSaveFailed", { turn: match.state().turn });
    return ok;
  };
  // Records WHY a resumable match was dropped before clearing it, so a silent
  // discard can never hide a bug (Feature D.5).
  const clearRecovery = (reason: string): void => {
    if (recoveryStore === null) return;
    logDebug("snapshotCleared", { reason });
    clearActiveMatch(recoveryStore);
    activeMatch = null;
    activeChosen = null;
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await auth.signOut();
    } finally {
      onSignOut();
    }
  };

  // Recent matches for the stats list (capped). If it can't load (Supabase down
  // or not configured), fall back to empty rather than crashing the page.
  const loadHistory = async (): Promise<MatchRecord[]> => {
    try {
      return await auth.getMatchHistory(session, 50);
    } catch {
      return [];
    }
  };

  // Aggregate win/loss/draw totals over the FULL history — the win counter and
  // reward progress derive from this, not from the 50-row recent window, so they
  // keep climbing once a player has played more than 50 matches. Same fallback.
  const loadStats = async (): Promise<AccountStats> => {
    try {
      return await auth.getMatchStats(session);
    } catch {
      return EMPTY_STATS;
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

  // Resolves which deck the player is actually using for `faction`: their saved
  // custom deck when it exists and is valid, else the starter deck (with a
  // fallback message). Best-effort: a load failure degrades to the starter deck.
  const resolveActiveDeck = async (
    faction: StarterFaction,
    owned?: readonly OwnedCardRecord[],
  ): Promise<ChosenActiveDeck> => {
    const ownedRows = owned ?? (await loadOwned());
    let saved = null;
    try {
      saved = await auth.getActiveDeck(session, faction);
    } catch {
      saved = null;
    }
    return chooseActiveDeck(saved, faction, pool, ownedRows);
  };

  // After a qualifying match the player picks one of three reward cards. The
  // options are derived from the faction's eligible pool, seeded by the match
  // seed so the offer is reproducible. Shown in a modal overlay so it's visible
  // without scrolling. Saving writes owned_cards + reward_events (best effort,
  // stamped with the milestone/tier); either way we return to the account, which
  // reloads the inventory. Cards can be inspected via the shared detail modal.
  const showReward = (
    faction: StarterFaction,
    seed: number,
    milestone: RewardMilestone,
  ): void => {
    const options = generateRewardOptions(faction, pool, createRng(seed));
    const detail = createCardDetail(assetBase);
    let overlay: HTMLElement;
    // Persist the chosen reward and report the outcome to the modal. We AWAIT the
    // save and only confirm the claim once it actually persisted. On a Supabase
    // failure (RLS/network) we DON'T lose it and DON'T pretend success: for a
    // signed-in remote account the choice is parked as a pending claim (retried
    // on later mounts) so the milestone's reward isn't re-claimable elsewhere and
    // Supabase stays the single owned-cards source of truth.
    const claim = async (card: Card): Promise<RewardClaimResult> => {
      const owned = buildOwnedCardInsert(session.userId, card);
      const event = buildRewardEventInsert(session.userId, faction, options, card, milestone);
      logDebug("rewardClaim", {
        slug: card.slug,
        milestone: milestone.milestone,
        mode: auth.isRemote ? "supabase" : "demo",
      });
      try {
        await auth.saveReward(session, owned, event);
      } catch (error) {
        // Supabase throws a plain error object, not an Error — describeError
        // pulls out the real Postgres message/code instead of "[object Object]".
        const lastError = describeError(error);
        logDebug("rewardClaimFailed", { slug: card.slug, error: lastError });
        if (auth.isRemote && pendingStore !== null) {
          const queued = appendPendingClaim(pendingStore, {
            userId: session.userId,
            owned,
            event,
            milestone: milestone.milestone,
            cardName: card.name,
            lastError,
          });
          logDebug("rewardClaimQueued", { slug: card.slug, status: queued.status });
          // "added" (new) or "duplicate" (already queued for this milestone) both
          // mean the reward IS pending — close to the account, where the pending
          // banner shows. The card is NOT owned until a retry succeeds.
          if (queued.status !== "error") {
            overlay.remove();
            void showAccount();
            return {
              ok: false,
              pending: true,
              message:
                "Your reward is saved locally but hasn't synced to your account " +
                "yet. Retry before editing your deck.",
            };
          }
        }
        // Couldn't even queue (no storage, or demo mode with no store): let the
        // player pick again rather than silently dropping the reward.
        return {
          ok: false,
          message:
            "Couldn't save your reward — check your connection and pick again.",
        };
      }
      // Saved: close the modal and return to the account, which reloads owned
      // cards from the same source the Deck Builder uses (so the new card shows).
      logDebug("rewardClaimSaved", { slug: card.slug });
      overlay.remove();
      void showAccount();
      return { ok: true, message: `${card.name} added to your collection!` };
    };
    overlay = renderRewardModal(options, assetBase, claim, (card) => detail.open(card));
    container.append(overlay, detail.element);
  };

  // A note about which deck is in play, shown above the result/board when a
  // custom deck is used or we fell back to the starter. Null when irrelevant.
  const deckNote = (chosen: ChosenActiveDeck): HTMLElement | null => {
    if (!(chosen.usedFallback || chosen.isCustom)) return null;
    const note = document.createElement("p");
    note.className =
      "account__deck-note" + (chosen.usedFallback ? "" : " account__deck-note--ok");
    note.textContent = chosen.message ?? "Using your custom deck.";
    return note;
  };

  // Shared match-completion flow used by BOTH the quick sim and the interactive
  // match: persist the result (best-effort), render the existing result screen,
  // and append the reward chooser ONLY when this win lands on a milestone (every
  // 5th win). We await the save so the reloaded history includes this match, then
  // derive the milestone from the win COUNT — never from reward_events — so
  // losses show nothing and legacy null-milestone rows can't re-unlock a reward.
  // `onPlayAgain` lets each entry point restart in its own mode.
  const finishMatch = async (
    faction: StarterFaction,
    summary: MatchSummary,
    chosen: ChosenActiveDeck,
    onPlayAgain: () => void,
  ): Promise<void> => {
    let saveFailed = false;
    try {
      await auth.saveMatch(
        session,
        buildMatchHistoryInsert(session.userId, summary),
      );
    } catch {
      // Persistence is best-effort; never block the result screen. We surface a
      // clear warning below so the player knows their stats may not have updated.
      saveFailed = true;
    }
    const result = renderMatchResult(summary, {
      onPlayAgain,
      onBack: () => void showAccount(),
    });
    const note = deckNote(chosen);
    swapMain(...(note ? [note, result] : [result]));
    // Onboarding match-completion nudge (Feature D): the result screen already
    // has Play again + Back to account; add an encouraging win/loss line.
    const nudge = document.createElement("p");
    nudge.className = "account__panel-body match-result__onboard-note";
    nudge.textContent = summary.playerWon
      ? "Nice win. Wins move you toward reward cards."
      : "You completed a match. Try again to build toward your first reward.";
    result.append(nudge);
    if (saveFailed) {
      const warn = document.createElement("p");
      warn.className = "account__panel-body match-result__save-warning";
      warn.setAttribute("role", "alert");
      warn.textContent =
        "Couldn't save this match — your stats may not have updated. " +
        "Check your connection and try again.";
      result.append(warn);
    }
    // Reward progress reads the FULL saved history (via getMatchStats), not the
    // capped recent window, so milestones fire on the true lifetime win count.
    const wins = (await loadStats()).wins;
    const milestone = rewardForMatch(summary.playerWon, wins);
    if (milestone !== null) {
      showReward(faction, summary.seed, milestone);
    } else {
      // No reward this match: tell the player when the next one unlocks rather
      // than leaving them wondering. Rewards are win-count based.
      const note = document.createElement("p");
      note.className = "account__panel-body match-result__reward-note";
      note.textContent = `Next reward at ${nextRewardMilestone(wins)} wins.`;
      result.append(note);
    }
  };

  // Quick sim: runs the full match through the auto-sim and shows the result.
  const showResult = async (faction: StarterFaction): Promise<void> => {
    // Use the saved custom deck when valid; otherwise the starter deck.
    const chosen = await resolveActiveDeck(faction);
    const summary = runTestMatch({
      faction,
      pool,
      playerDeck: chosen.isCustom ? chosen.entries : undefined,
    });
    await finishMatch(faction, summary, chosen, () => void showResult(faction));
  };

  // Mounts the live board for an already-built match and wires recovery: persist
  // after every move, clear when the match ends or is conceded. Shared by a fresh
  // start (showPlayableMatch) and a resumed one (resumeMatch).
  const launchMatch = (match: PlayableMatch, chosen: ChosenActiveDeck): void => {
    const faction = match.playerFaction;
    currentView = "live-match";
    // Onboarding marker: a match played with the saved custom deck completes the
    // final checklist step (no server signal records which deck a match used).
    if (chosen.isCustom) markOnboardingProgress(tutorialStore, "customDeckMatchPlayed");
    persistMatch(match, chosen, true); // checkpoint the starting/resumed state
    // Reuse the shared card-detail modal (same as the Card Viewer / Deck
    // Builder). It lives as a sibling of the board so the board's in-place
    // re-renders never disturb the open dialog.
    const detail = createCardDetail(assetBase);
    const board = renderPlayableMatch(match, {
      onComplete: (summary) => {
        clearRecovery("match completed"); // finished — nothing to resume
        void finishMatch(faction, summary, chosen, () =>
          void showPlayableMatch(faction),
        );
      },
      onQuit: () => {
        clearRecovery("conceded"); // conceding abandons the in-progress match
        void showAccount();
      },
      onInspect: (card) => detail.open(card),
      onAction: () => persistMatch(match, chosen),
      onReportIssue: () =>
        openFeedbackModal({
          auth,
          store: feedbackStore,
          defaultType: "bug",
          context: () => {
            // Compact live-match summary (Feature C): counts only, never the
            // full deck/board state.
            const s = match.state();
            const me = s.players.player1;
            const them = s.players.player2;
            return {
              view: "live-match",
              userId: session.userId,
              email: info0.email,
              selectedFaction: faction,
              match: {
                turn: s.turn,
                phase: s.phase,
                activePlayer: s.activePlayer,
                playerLives: me.lives,
                opponentLives: them.lives,
                handCount: me.hand.length,
                fieldCount: me.field.length,
                opponentFieldCount: them.field.length,
                eventCount: s.events.length,
                winner: s.winner,
              },
            };
          },
        }),
    });
    const note = deckNote(chosen);
    swapMain(...(note ? [note, board] : [board]), detail.element);
    mountDebugPanel(container);
    activeBoard = board;
  };

  // Interactive match: mounts the live board. The same active-deck resolution as
  // the sim feeds the human's deck; on game over the board hands back the summary
  // and we route into the shared finishMatch flow (history + reward intact).
  const showPlayableMatch = async (faction: StarterFaction): Promise<void> => {
    const chosen = await resolveActiveDeck(faction);
    const match = createPlayableMatch({
      faction,
      pool,
      playerDeck: chosen.isCustom ? chosen.entries : undefined,
    });
    launchMatch(match, chosen);
  };

  // Resume an interrupted match from its saved descriptor by replaying the saved
  // actions onto a fresh match with the exact same seed/opponent/deck. If the
  // save no longer fits this build (ReplayError) we discard it and return to the
  // account rather than crash.
  const resumeMatch = (saved: SavedMatch): void => {
    let match: PlayableMatch;
    try {
      match = createPlayableMatch({
        faction: saved.faction,
        pool,
        seed: saved.seed,
        opponentFaction: saved.opponentFaction,
        playerDeck: saved.playerDeck ?? undefined,
        replay: saved.actions,
      });
    } catch (error) {
      // Record WHY before discarding an invalid snapshot (Feature D.5/D.6).
      const message = error instanceof Error ? error.message : String(error);
      clearRecovery(`replay failed: ${message}`);
      if (error instanceof ReplayError) {
        invalidResumeMessage =
          "Your saved match could no longer be resumed and was discarded.";
        void showAccount();
        return;
      }
      throw error;
    }
    const chosen: ChosenActiveDeck =
      saved.playerDeck !== null
        ? { entries: [...saved.playerDeck], isCustom: true, usedFallback: false }
        : { entries: [], isCustom: false, usedFallback: false };
    launchMatch(match, chosen);
  };

  // A "Resume match?" banner shown above the account card when a live match was
  // interrupted (e.g. a mobile tab reload). Offers Resume or Discard.
  const renderResumeBanner = (saved: SavedMatch): HTMLElement => {
    const banner = document.createElement("section");
    banner.className = "account__panel account__resume";
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent = "Match in progress";
    banner.append(heading);
    const body = document.createElement("p");
    body.className = "account__panel-body";
    body.textContent =
      `You have a live ${saved.faction} match in progress (turn ${saved.turn}). ` +
      "Resume where you left off?";
    banner.append(body);
    const row = document.createElement("div");
    row.className = "account__resume-actions";
    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "account__play account__resume-btn";
    resume.textContent = "Resume match";
    resume.addEventListener("click", () => resumeMatch(saved));
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "account__signout account__resume-discard";
    discard.textContent = "Discard";
    discard.addEventListener("click", () => {
      clearRecovery("user discarded");
      void showAccount();
    });
    row.append(resume, discard);
    banner.append(row);
    return banner;
  };

  // A "N rewards pending sync" banner shown when one or more rewards couldn't save
  // to Supabase and are queued for retry. Offers a manual "Retry now"; claims are
  // never silently discarded — they stay here (with the latest error) until each
  // one syncs.
  const renderPendingRewardBanner = (
    claims: readonly PendingRewardClaim[],
  ): HTMLElement => {
    const count = claims.length;
    const banner = document.createElement("section");
    banner.className = "account__panel account__pending-reward";
    banner.setAttribute("role", "status");
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent =
      count === 1 ? "1 reward pending sync" : `${count} rewards pending sync`;
    banner.append(heading);
    const body = document.createElement("p");
    body.className = "account__panel-body";
    const names = claims.map((c) => c.cardName).join(", ");
    body.textContent =
      `${names} ${count === 1 ? "isn't" : "aren't"} saved to your account yet — ` +
      "we'll retry when your account reconnects. " +
      `${count === 1 ? "It won't" : "They won't"} be added to your collection until ` +
      `${count === 1 ? "it syncs" : "they sync"}.`;
    banner.append(body);
    // Show the most recent error (claims share a cause when the backend is down).
    const lastErr = claims.map((c) => c.lastError).find((e) => e.length > 0);
    if (lastErr !== undefined) {
      const err = document.createElement("p");
      err.className = "account__pending-reward-error";
      err.textContent = `Last error: ${lastErr}.`;
      banner.append(err);
    }
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "account__play account__pending-reward-retry";
    retry.textContent = "Retry now";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Retrying…";
      void syncPendingRewards(auth, session, pendingStore).finally(() =>
        void showAccount(),
      );
    });
    banner.append(retry);
    return banner;
  };

  // Unsent feedback banner (Feature F): a count + a retry that re-syncs the queue
  // against the backend. Mirrors the pending-reward banner; never discards.
  const renderPendingFeedbackBanner = (): HTMLElement => {
    const count =
      feedbackStore !== null ? pendingFeedbackCount(feedbackStore) : 0;
    const banner = document.createElement("section");
    banner.className = "account__panel account__pending-feedback";
    banner.setAttribute("role", "status");
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent =
      count === 1 ? "1 feedback report pending" : `${count} feedback reports pending`;
    banner.append(heading);
    const body = document.createElement("p");
    body.className = "account__panel-body";
    body.textContent =
      "Your feedback couldn't be sent yet — we kept it on this device and will " +
      "retry. It won't be lost.";
    banner.append(body);
    const lastErr =
      feedbackStore !== null
        ? loadPendingFeedback(feedbackStore)
            .map((f) => f.lastError)
            .find((e) => e.length > 0)
        : undefined;
    if (lastErr !== undefined) {
      const err = document.createElement("p");
      err.className = "account__pending-reward-error";
      err.textContent = `Last error: ${lastErr}.`;
      banner.append(err);
    }
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "account__play account__pending-feedback-retry";
    retry.textContent = "Retry now";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Retrying…";
      void syncPendingFeedback(auth, feedbackStore).finally(
        () => void showAccount(),
      );
    });
    banner.append(retry);
    return banner;
  };

  // A live snapshot of the reward/owned pipeline for the debug panel, refreshed
  // each showAccount. Lets a dump answer "why aren't rewards showing": the auth
  // mode, win count, owned count, and any pending-claim errors.
  let rewardDiag: Record<string, unknown> = {
    mode: auth.isRemote ? "supabase" : "demo",
  };

  // Debug panel (Feature A): mounted only when euphoriaDebug=1. It can force-save
  // the active match and simulate a reload check against the saved snapshot.
  const mountDebugPanel = (host: HTMLElement): void => {
    const panel = createDebugPanel({
      userId: () => session.userId,
      currentView: () => currentView,
      store: recoveryStore,
      reward: () => rewardDiag,
      onFeedback: () =>
        openFeedbackModal({
          auth,
          store: feedbackStore,
          defaultType: "bug",
          context: () => ({
            view: currentView,
            userId: session.userId,
            email: info0.email,
            selectedFaction: info0.faction,
            reward: rewardDiag,
          }),
        }),
      forceSave: () => {
        if (activeMatch === null || activeChosen === null) return false;
        return persistMatch(activeMatch, activeChosen, true);
      },
      simulateReloadCheck: () => {
        if (recoveryStore === null) return "no storage";
        const info = snapshotInfo(recoveryStore, session.userId);
        if (!info.exists) return "Reload check: no snapshot — Resume would NOT show";
        if (info.problem !== null) return `Reload check: invalid (${info.problem})`;
        return `Reload check: OK — Resume would show (turn ${info.turn})`;
      },
    });
    if (panel !== null) host.append(panel.element);
  };

  const showAccount = async (): Promise<void> => {
    currentView = "account";
    // Retry any rewards that failed to save before loading the inventory, so a
    // just-synced card shows up immediately. Cheap no-op when nothing is pending.
    await syncPendingRewards(auth, session, pendingStore);
    const [records, owned, stats] = await Promise.all([
      loadHistory(),
      loadOwned(),
      loadStats(),
    ]);
    // Reflect which deck is active (and any fallback) when a faction is chosen.
    const chosen =
      info0.faction !== null
        ? await resolveActiveDeck(info0.faction, owned)
        : null;
    // Pending reward claims feed both the banner and the next-step guidance.
    const pending =
      pendingStore !== null ? loadPendingClaims(pendingStore, session.userId) : [];
    const info: AccountInfo = {
      ...info0,
      stats,
      recent: recentMatches(records, 5),
      inventory: computeInventoryStats(owned),
      owned: groupOwnedBySlug(owned),
      deckMode: chosen?.isCustom ? "Custom Deck" : "Starter Deck",
      deckNote: chosen?.usedFallback ? chosen.message : undefined,
      // The prominent "Getting Started" checklist (below) is now the primary
      // guidance, so the small inline next-step card is omitted here.
    };
    const accountEl = renderAccount(
      info,
      pool,
      handleSignOut,
      showResult,
      (faction) => void showPlayableMatch(faction),
    );
    // "Reset tutorial tips" (Feature H): clears only tutorial dismissals, never
    // game progression. Re-renders so any re-enabled hints reappear.
    if (tutorialStore !== null) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "account__reset-tutorial";
      reset.textContent = "Reset tutorial tips";
      reset.addEventListener("click", () => {
        resetTutorial(tutorialStore);
        void showAccount();
      });
      accountEl.append(reset);
    }
    // "Send feedback" (Feature A): an account-level entry point. Attaches the
    // signed-in user, faction, active deck mode, and reward snapshot.
    const feedbackBtn = document.createElement("button");
    feedbackBtn.type = "button";
    feedbackBtn.className = "account__feedback";
    feedbackBtn.textContent = "Send feedback";
    feedbackBtn.addEventListener("click", () =>
      openFeedbackModal({
        auth,
        store: feedbackStore,
        context: () => ({
          view: "account",
          userId: session.userId,
          email: info.email,
          selectedFaction: info0.faction,
          deckMode: info.deckMode,
          reward: rewardDiag,
        }),
      }),
    );
    accountEl.append(feedbackBtn);
    // A one-time notice if the last resume attempt failed validation (D.6).
    const nodes: Node[] = [];
    // Unsent feedback (Feature F): keep it visible with a retry until it sends.
    if (feedbackStore !== null && pendingFeedbackCount(feedbackStore) > 0) {
      nodes.push(renderPendingFeedbackBanner());
    }
    if (invalidResumeMessage !== null) {
      const warn = document.createElement("p");
      warn.className = "account__panel-body account__resume-invalid";
      warn.setAttribute("role", "alert");
      warn.textContent = invalidResumeMessage;
      invalidResumeMessage = null;
      nodes.push(warn);
    }
    // Prominent "Getting Started" checklist (Onboarding v2) — the primary
    // guidance, derived from real account state (faction, matches, rewards, deck)
    // plus two local action markers. Shown until complete-and-dismissed.
    const checklist = buildChecklist({
      hasFaction: info0.faction !== null,
      matchCount: stats.total,
      winCount: stats.wins,
      ownedCount: owned.length,
      pendingCount: pending.length,
      hasCustomDeck: chosen?.isCustom === true,
      deckBuilderOpened: hasOnboardingProgress(tutorialStore, "deckBuilderOpened"),
      customDeckMatchPlayed: hasOnboardingProgress(tutorialStore, "customDeckMatchPlayed"),
    });
    // "Hidden" persists across visits; "expanded" is session/mount-scoped so the
    // card defaults back to its compact shape on each return to the account.
    const hidden = isOnboardingDismissed(tutorialStore);
    if (hidden && !checklist.complete) {
      // Hidden but unfinished: a tiny button to bring the guide back.
      nodes.push(
        renderShowGuide(() => {
          setOnboardingDismissed(tutorialStore, false);
          void showAccount();
        }),
      );
    } else if (!(checklist.complete && hidden)) {
      const runCta = (item: ChecklistItem): void => {
        switch (item.cta) {
          case "Choose Starter Deck":
            options.onNavigate?.("starter");
            break;
          case "Open Deck Builder":
            options.onNavigate?.("deckbuilder");
            break;
          case "Retry Reward Sync":
            void syncPendingRewards(auth, session, pendingStore).finally(
              () => void showAccount(),
            );
            break;
          case "Play Match":
            if (info0.faction !== null) void showPlayableMatch(info0.faction);
            else options.onNavigate?.("starter");
            break;
        }
      };
      nodes.push(
        renderChecklistCard(checklist, onboardingExpanded ? "expanded" : "compact", {
          onCta: runCta,
          onExpand: () => {
            onboardingExpanded = true;
            void showAccount();
          },
          onCollapse: () => {
            onboardingExpanded = false;
            void showAccount();
          },
          onHide: () => {
            setOnboardingDismissed(tutorialStore, true);
            void showAccount();
          },
          onDismissComplete: () => {
            setOnboardingDismissed(tutorialStore, true);
            void showAccount();
          },
        }),
      );
    }
    // Any rewards still pending sync (after the retry above) stay visible until
    // each one syncs — never silently discarded.
    if (pending.length > 0) nodes.push(renderPendingRewardBanner(pending));
    // Refresh the debug panel's reward snapshot from the freshly-loaded data.
    rewardDiag = {
      mode: auth.isRemote ? "supabase" : "demo",
      wins: stats.wins,
      nextReward: nextRewardMilestone(stats.wins),
      owned: owned.length,
      pending: pending.length,
      pendingErrors: pending
        .filter((c) => c.lastError.length > 0)
        .map((c) => `${c.cardName}: ${c.lastError}`),
    };
    // Surface a resume prompt if a live match was interrupted (scoped to user).
    const saved =
      recoveryStore !== null ? loadActiveMatch(recoveryStore, session.userId) : null;
    if (saved !== null) nodes.push(renderResumeBanner(saved));
    nodes.push(accountEl);
    swapMain(...nodes);
    mountDebugPanel(container);
  };

  // When asked (e.g. coming from the Deck Builder's "Play match"), jump straight
  // into the interactive match for the chosen faction instead of the card.
  if (options.autoPlay !== undefined && info0.faction === options.autoPlay) {
    await showPlayableMatch(options.autoPlay);
  } else {
    await showAccount();
  }
}
