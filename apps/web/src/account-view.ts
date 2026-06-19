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
import { renderMatchResult } from "./match-view";
import { runTestMatch, type MatchSummary } from "./match";
import { createPlayableMatch, ReplayError, type PlayableMatch } from "./play-match";
import { renderPlayableMatch, type PlayableMatchBoard } from "./play-match-view";
import { createCardDetail } from "./detail";
import {
  clearActiveMatch,
  getSessionStore,
  loadActiveMatch,
  saveActiveMatch,
  type SavedMatch,
} from "./match-recovery";
import {
  buildMatchHistoryInsert,
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
import { chooseActiveDeck, type ChosenActiveDeck } from "./deck-builder";
import { renderRewardModal } from "./reward-view";
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
} from "./rewards";

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
  // action history) to sessionStorage after each move, so a mobile tab reload
  // mid-match can offer "Resume". Best-effort — null when storage is unavailable.
  const recoveryStore = getSessionStore();
  const persistMatch = (match: PlayableMatch, chosen: ChosenActiveDeck): void => {
    if (recoveryStore === null) return;
    saveActiveMatch(recoveryStore, {
      userId: session.userId,
      faction: match.playerFaction,
      opponentFaction: match.opponentFaction,
      seed: match.seed,
      playerDeck: chosen.isCustom ? [...chosen.entries] : null,
      actions: match.history(),
      turn: match.state().turn,
    });
  };
  const clearRecovery = (): void => {
    if (recoveryStore !== null) clearActiveMatch(recoveryStore);
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
    const overlay = renderRewardModal(
      options,
      assetBase,
      (card) => {
        overlay.remove();
        void auth
          .saveReward(
            session,
            buildOwnedCardInsert(session.userId, card),
            buildRewardEventInsert(session.userId, faction, options, card, milestone),
          )
          .catch(() => {
            /* persistence is best-effort; never block returning to account */
          })
          .finally(() => void showAccount());
      },
      (card) => detail.open(card),
    );
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
    persistMatch(match, chosen); // checkpoint the starting/resumed state
    // Reuse the shared card-detail modal (same as the Card Viewer / Deck
    // Builder). It lives as a sibling of the board so the board's in-place
    // re-renders never disturb the open dialog.
    const detail = createCardDetail(assetBase);
    const board = renderPlayableMatch(match, {
      onComplete: (summary) => {
        clearRecovery(); // the match is finished — nothing to resume
        void finishMatch(faction, summary, chosen, () =>
          void showPlayableMatch(faction),
        );
      },
      onQuit: () => {
        clearRecovery(); // conceding abandons the in-progress match
        void showAccount();
      },
      onInspect: (card) => detail.open(card),
      onAction: () => persistMatch(match, chosen),
    });
    const note = deckNote(chosen);
    swapMain(...(note ? [note, board] : [board]), detail.element);
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
      clearRecovery();
      if (error instanceof ReplayError) {
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
      clearRecovery();
      void showAccount();
    });
    row.append(resume, discard);
    banner.append(row);
    return banner;
  };

  const showAccount = async (): Promise<void> => {
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
    const info: AccountInfo = {
      ...info0,
      stats,
      recent: recentMatches(records, 5),
      inventory: computeInventoryStats(owned),
      owned: groupOwnedBySlug(owned),
      deckMode: chosen?.isCustom ? "Custom Deck" : "Starter Deck",
      deckNote: chosen?.usedFallback ? chosen.message : undefined,
    };
    const accountEl = renderAccount(
      info,
      pool,
      handleSignOut,
      showResult,
      (faction) => void showPlayableMatch(faction),
    );
    // Surface a resume prompt if a live match was interrupted (scoped to user).
    const saved =
      recoveryStore !== null ? loadActiveMatch(recoveryStore, session.userId) : null;
    if (saved !== null) {
      swapMain(renderResumeBanner(saved), accountEl);
    } else {
      swapMain(accountEl);
    }
  };

  // When asked (e.g. coming from the Deck Builder's "Play match"), jump straight
  // into the interactive match for the chosen faction instead of the card.
  if (options.autoPlay !== undefined && info0.faction === options.autoPlay) {
    await showPlayableMatch(options.autoPlay);
  } else {
    await showAccount();
  }
}
