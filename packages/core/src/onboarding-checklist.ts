/**
 * Onboarding v2 — the guided "Getting Started" checklist. PURE logic (no DOM):
 * given the player's real account state it returns the 8-step checklist with a
 * done/current/upcoming status per step, the current actionable step (copy +
 * CTA), and a completion verdict. Rendering lives in onboarding-checklist-view.
 *
 * Two of the eight steps ("Open Deck Builder", "Play with custom deck") have no
 * server-side signal, so the caller supplies two local progress markers for them
 * (persisted separately from the dismissal flag so a dismissal never un-completes
 * real progress). Everything else derives from account data — match/win counts,
 * owned/pending rewards, the active deck — per the milestone's Feature H.
 */
import { WIN_MILESTONE_INTERVAL } from "@euphoria/core/rewards";
import type { KeyValueStore } from "@euphoria/core/signup";

/** localStorage keys: progress markers (actions) and the dismissed/collapsed bit. */
export const ONBOARDING_PROGRESS_KEY = "euphoria.onboardingProgress.v1";
export const ONBOARDING_DISMISSED_KEY = "euphoria.onboardingDismissed.v1";

/** Local action markers for steps with no account-data signal. */
export type ProgressMarker = "deckBuilderOpened" | "customDeckMatchPlayed";

/** The account-derived (+ two local) state the checklist is computed from. */
export interface ChecklistState {
  readonly hasFaction: boolean;
  readonly matchCount: number;
  readonly winCount: number;
  /** Owned (synced) reward cards. */
  readonly ownedCount: number;
  /** Reward claims queued but not yet synced to the account. */
  readonly pendingCount: number;
  readonly hasCustomDeck: boolean;
  readonly deckBuilderOpened: boolean;
  readonly customDeckMatchPlayed: boolean;
}

export type ItemStatus = "done" | "current" | "upcoming";

/** One checklist row. `body`/`cta` are most relevant on the current step. */
export interface ChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly body: string;
  /** CTA label for the current next action; absent = no button. */
  readonly cta?: string;
  readonly status: ItemStatus;
}

/** The computed checklist. */
export interface Checklist {
  readonly items: readonly ChecklistItem[];
  readonly doneCount: number;
  readonly total: number;
  /** Core onboarding finished (faction + a match + a reward + a custom deck). */
  readonly complete: boolean;
  /** Shown when complete. */
  readonly completionMessage: string;
  /** The id of the current actionable step, or undefined when complete. */
  readonly currentId?: string;
}

/**
 * The 8 onboarding steps with their `done` predicate and current-step copy/CTA.
 * Order is the player journey; the first not-done step becomes "current".
 */
function buildItems(
  state: ChecklistState,
): readonly { id: string; label: string; done: boolean; body: string; cta?: string }[] {
  const milestoneReached =
    state.winCount >= WIN_MILESTONE_INTERVAL ||
    state.ownedCount > 0 ||
    state.pendingCount > 0;
  const pending = state.pendingCount > 0 && state.ownedCount === 0;
  return [
    {
      id: "choose-starter",
      label: "Choose starter deck",
      done: state.hasFaction,
      body: "Choose your starter faction to receive your first 30-card deck.",
      cta: "Choose Starter Deck",
    },
    {
      id: "play-first-match",
      label: "Play first match",
      done: state.matchCount >= 1,
      body: "Play your first live match to learn the flow.",
      cta: "Play Match",
    },
    {
      id: "win-first-match",
      label: "Win first match",
      done: state.winCount >= 1,
      body: "Win a match — wins move you toward reward cards.",
      cta: "Play Match",
    },
    {
      id: "first-milestone",
      label: "Reach first reward milestone",
      done: milestoneReached,
      body: `Win matches to reach your first reward milestone (${WIN_MILESTONE_INTERVAL} wins).`,
      cta: "Play Match",
    },
    {
      id: "claim-reward",
      label: "Claim first reward",
      done: state.ownedCount >= 1,
      body: pending
        ? "Your reward is pending sync. Retry before editing your deck."
        : "Win to earn a reward, then claim a card for your collection.",
      cta: pending ? "Retry Reward Sync" : "Play Match",
    },
    {
      id: "open-deck-builder",
      label: "Open Deck Builder",
      done: state.deckBuilderOpened || state.hasCustomDeck,
      body: "Add your earned card in Deck Builder.",
      cta: "Open Deck Builder",
    },
    {
      id: "save-custom-deck",
      label: "Save custom deck",
      done: state.hasCustomDeck,
      body: "Build and save a custom 30-card deck.",
      cta: "Open Deck Builder",
    },
    {
      id: "play-custom-deck",
      label: "Play with custom deck",
      done: state.customDeckMatchPlayed,
      body: "Test your custom deck in a live match.",
      cta: "Play Match",
    },
  ];
}

/** Builds the full checklist with per-step status and the completion verdict. */
export function buildChecklist(state: ChecklistState): Checklist {
  const raw = buildItems(state);
  const currentIndex = raw.findIndex((i) => !i.done);
  const items: ChecklistItem[] = raw.map((i, idx) => ({
    id: i.id,
    label: i.label,
    body: i.body,
    cta: idx === currentIndex ? i.cta : undefined,
    status: i.done ? "done" : idx === currentIndex ? "current" : "upcoming",
  }));
  // Feature G: "set up" once a faction is chosen, a match played, a reward
  // claimed, and a custom deck saved.
  const complete =
    state.hasFaction &&
    state.matchCount >= 1 &&
    state.ownedCount >= 1 &&
    state.hasCustomDeck;
  return {
    items,
    doneCount: raw.filter((i) => i.done).length,
    total: raw.length,
    complete,
    completionMessage:
      "You're set up. Keep playing to earn more cards and refine your deck.",
    currentId: currentIndex === -1 ? undefined : raw[currentIndex]!.id,
  };
}

// --- local persistence ------------------------------------------------------

function readSet(store: KeyValueStore, key: string): Record<string, boolean> {
  const raw = store.getItem(key);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

/** Records that the player took an action with no account-data signal. */
export function markOnboardingProgress(
  store: KeyValueStore | null,
  marker: ProgressMarker,
): void {
  if (store === null) return;
  const set = readSet(store, ONBOARDING_PROGRESS_KEY);
  set[marker] = true;
  try {
    store.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(set));
  } catch {
    /* best-effort */
  }
}

/** True when `marker` has been recorded. */
export function hasOnboardingProgress(
  store: KeyValueStore | null,
  marker: ProgressMarker,
): boolean {
  if (store === null) return false;
  return readSet(store, ONBOARDING_PROGRESS_KEY)[marker] === true;
}

/** True when the player collapsed/hid the checklist. */
export function isOnboardingDismissed(store: KeyValueStore | null): boolean {
  if (store === null) return false;
  return store.getItem(ONBOARDING_DISMISSED_KEY) === "1";
}

/** Collapses/hides the checklist (does not affect progress markers or state). */
export function setOnboardingDismissed(
  store: KeyValueStore | null,
  dismissed: boolean,
): void {
  if (store === null) return;
  try {
    if (dismissed) store.setItem(ONBOARDING_DISMISSED_KEY, "1");
    else store.removeItem(ONBOARDING_DISMISSED_KEY);
  } catch {
    /* best-effort */
  }
}
