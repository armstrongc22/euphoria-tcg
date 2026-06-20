/**
 * Onboarding / tutorial layer — PURE logic + localStorage-backed dismissal flags.
 * No DOM, no engine, no Supabase. Two concerns:
 *
 *   1. Dismissal flags (Feature G/H): which one-off tutorial bits the player has
 *      hidden ("Don't show again" / Skip). Stored in one versioned localStorage
 *      key as a flat object; "Reset tutorial tips" clears them all and nothing
 *      else (never touches game progression).
 *   2. nextStep() (Feature C): the single contextual "what to do next" hint,
 *      derived from the account's current state. Pure + deterministic, so it's
 *      unit-tested without a browser.
 *
 * This changes no gameplay — it's guidance copy + visibility state only.
 */
import type { KeyValueStore } from "./signup";

/** localStorage key holding the dismissal flags. Versioned. */
export const TUTORIAL_STORAGE_KEY = "euphoria.tutorial.v1";

/** The dismissible tutorial surfaces. */
export type TutorialFlag = "welcome" | "liveHints" | "deckBuilder" | "reward";

/** Every flag, for the "Reset tutorial tips" action + tests. */
export const TUTORIAL_FLAGS: readonly TutorialFlag[] = [
  "welcome",
  "liveHints",
  "deckBuilder",
  "reward",
];

function readFlags(store: KeyValueStore): Record<string, boolean> {
  const raw = store.getItem(TUTORIAL_STORAGE_KEY);
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

function writeFlags(store: KeyValueStore, flags: Record<string, boolean>): void {
  try {
    store.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* best-effort: a hidden tip simply reappears next time */
  }
}

/** True when the player has dismissed `flag`. False when storage is null. */
export function isTutorialDismissed(
  store: KeyValueStore | null,
  flag: TutorialFlag,
): boolean {
  if (store === null) return false;
  return readFlags(store)[flag] === true;
}

/** Marks `flag` dismissed so its tutorial surface stops showing. */
export function dismissTutorial(
  store: KeyValueStore | null,
  flag: TutorialFlag,
): void {
  if (store === null) return;
  const flags = readFlags(store);
  flags[flag] = true;
  writeFlags(store, flags);
}

/** Clears ALL tutorial dismissals (Feature H). Affects only tutorial visibility. */
export function resetTutorial(store: KeyValueStore | null): void {
  if (store === null) return;
  try {
    store.removeItem(TUTORIAL_STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Returns localStorage for tutorial flags, or null when unavailable. Unlike the
 * recovery/pending stores this does NOT write a probe — tutorial flags are
 * best-effort (reads tolerate absence, writes are try/catch'd), and a probe
 * write at access time is needless work on a hot path (e.g. each match mount).
 */
export function getTutorialStore(): KeyValueStore | null {
  try {
    return (globalThis.localStorage as KeyValueStore | undefined) ?? null;
  } catch {
    return null;
  }
}

// --- Account "Next step" guidance (Feature C) -------------------------------

/** The account state the next-step hint is derived from. */
export interface NextStepState {
  readonly hasFaction: boolean;
  readonly matchCount: number;
  readonly ownedCount: number;
  readonly pendingCount: number;
  readonly hasCustomDeck: boolean;
}

/** One contextual next-step hint: an id (for tests/styling), body, optional CTA. */
export interface NextStep {
  readonly id: string;
  readonly body: string;
  /** A call-to-action label the UI may render as a button; absent = no button. */
  readonly cta?: string;
}

/**
 * The single most relevant "what to do next" hint for the current account state.
 * Priority is deliberate: get a faction first; a pending reward is urgent (act
 * before editing the deck); otherwise nudge along the natural loop
 * (play → win → build → test). Pure and exhaustive — always returns a step.
 */
export function nextStep(state: NextStepState): NextStep {
  if (!state.hasFaction) {
    return { id: "choose-faction", body: "Choose a starter deck to begin.", cta: "Starter Decks" };
  }
  if (state.pendingCount > 0) {
    return {
      id: "pending-reward",
      body: "Reward pending sync — retry before editing your deck.",
    };
  }
  if (state.hasCustomDeck) {
    return {
      id: "custom-active",
      body: "Your custom deck is active. Start a live match to test it.",
      cta: "Play match",
    };
  }
  if (state.ownedCount > 0) {
    return {
      id: "build-deck",
      body: "Use Deck Builder to add earned cards to your deck.",
      cta: "Deck Builder",
    };
  }
  if (state.matchCount === 0) {
    return { id: "first-match", body: "Play your first live match.", cta: "Play match" };
  }
  return {
    id: "win-rewards",
    body: "Win matches to reach your next reward milestone.",
  };
}
