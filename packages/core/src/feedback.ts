/**
 * Beta feedback / bug reporting — PURE logic (no DOM, no network). Three jobs:
 *
 *   1. The feedback report shape ({@link FeedbackInsert}) and a builder that
 *      assembles the auto-attached debug context (build/view/user-agent/mobile,
 *      plus a compact match/reward/onboarding summary) — kept lightweight: never
 *      full deck/match state.
 *   2. A localStorage pending queue (Feature F): if the Supabase insert fails the
 *      report is parked here and retried, never silently dropped.
 *   3. syncPendingFeedback(): retries the queue against the backend.
 *
 * Storage is injected via {@link KeyValueStore}, so it's fully unit-testable.
 */
import type { Auth } from "./auth";
import type { KeyValueStore } from "@euphoria/core/signup";

/** The feedback categories the form offers. */
export type FeedbackType =
  | "bug"
  | "confusing-ux"
  | "balance"
  | "card-issue"
  | "mobile"
  | "general";

/** Every type with a display label, for the form's select. */
export const FEEDBACK_TYPES: readonly { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "confusing-ux", label: "Confusing UX" },
  { value: "balance", label: "Balance issue" },
  { value: "card-issue", label: "Card issue" },
  { value: "mobile", label: "Mobile issue" },
  { value: "general", label: "General feedback" },
];

/** The columns inserted into `feedback_reports` (id/created_at are DB defaults). */
export interface FeedbackInsert {
  readonly user_id: string | null;
  readonly email: string | null;
  readonly type: FeedbackType;
  readonly message: string;
  readonly view: string | null;
  readonly build: string | null;
  readonly user_agent: string | null;
  readonly mobile: boolean;
  readonly selected_faction: string | null;
  /** Compact extra context (onboarding step, match/reward summary, debug events). */
  readonly context: Record<string, unknown>;
}

/** Everything a caller supplies to build a report; the rest is auto-attached. */
export interface FeedbackInput {
  readonly type: FeedbackType;
  readonly message: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly view: string | null;
  readonly build: string | null;
  readonly userAgent: string | null;
  readonly mobile: boolean;
  readonly selectedFaction: string | null;
  /** Whether to attach recent debug events (the "Include debug info" checkbox). */
  readonly includeDebug: boolean;
  /** Compact, optional context pieces gathered by the caller. */
  readonly deckMode?: string;
  readonly onboardingStep?: string;
  readonly match?: Record<string, unknown>;
  readonly reward?: Record<string, unknown>;
  readonly debugEvents?: readonly unknown[];
}

/** True when a report has a non-empty message (the only hard requirement). */
export function isValidFeedback(message: string): boolean {
  return message.trim().length > 0;
}

/**
 * Assembles the insert from the caller's input, folding the optional pieces into
 * the `context` jsonb. Debug events are attached only when the user opted in
 * (Include debug info). Pure — `message` is trimmed but otherwise unchanged.
 */
export function buildFeedbackInsert(input: FeedbackInput): FeedbackInsert {
  const context: Record<string, unknown> = {};
  if (input.deckMode !== undefined) context["deckMode"] = input.deckMode;
  if (input.onboardingStep !== undefined) context["onboardingStep"] = input.onboardingStep;
  if (input.match !== undefined) context["match"] = input.match;
  if (input.reward !== undefined) context["reward"] = input.reward;
  if (input.includeDebug && input.debugEvents !== undefined && input.debugEvents.length > 0) {
    context["debugEvents"] = input.debugEvents.slice(-25);
  }
  return {
    user_id: input.userId,
    email: input.email !== null && input.email.trim().length > 0 ? input.email.trim() : null,
    type: input.type,
    message: input.message.trim(),
    view: input.view,
    build: input.build,
    user_agent: input.userAgent,
    mobile: input.mobile,
    selected_faction: input.selectedFaction,
    context,
  };
}

// --- local pending queue (Feature F) ----------------------------------------

/** localStorage key holding unsent feedback. Versioned. */
export const PENDING_FEEDBACK_KEY = "euphoria.pendingFeedback.v1";

/** One queued report: the insert plus retry metadata. */
export interface PendingFeedback {
  readonly id: string;
  readonly insert: FeedbackInsert;
  readonly lastError: string;
  readonly attempts: number;
  readonly createdAt: string;
}

function readAll(store: KeyValueStore): PendingFeedback[] {
  const raw = store.getItem(PENDING_FEEDBACK_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingFeedback[]) : [];
  } catch {
    return [];
  }
}

function writeAll(store: KeyValueStore, items: readonly PendingFeedback[]): boolean {
  try {
    if (items.length === 0) store.removeItem(PENDING_FEEDBACK_KEY);
    else store.setItem(PENDING_FEEDBACK_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/** Parks an unsent report. Returns false only if storage is blocked/full. */
export function savePendingFeedback(
  store: KeyValueStore,
  insert: FeedbackInsert,
  lastError: string,
  now: Date = new Date(),
): boolean {
  const all = readAll(store);
  all.push({
    id: `${now.getTime()}-${Math.floor(Math.random() * 1e6)}`,
    insert,
    lastError,
    attempts: 1,
    createdAt: now.toISOString(),
  });
  return writeAll(store, all);
}

/** The queued (unsent) reports, oldest first. */
export function loadPendingFeedback(store: KeyValueStore): PendingFeedback[] {
  return readAll(store);
}

/** How many reports are queued (for the "Feedback pending" badge). */
export function pendingFeedbackCount(store: KeyValueStore): number {
  return readAll(store).length;
}

/** Removes one report by id (after it sends). */
export function removePendingFeedback(store: KeyValueStore, id: string): void {
  writeAll(store, readAll(store).filter((f) => f.id !== id));
}

function recordFailure(store: KeyValueStore, id: string, error: string): void {
  writeAll(
    store,
    readAll(store).map((f) =>
      f.id === id ? { ...f, attempts: f.attempts + 1, lastError: error } : f,
    ),
  );
}

/** Result of a retry pass over the queue. */
export interface FeedbackSyncResult {
  readonly sent: number;
  readonly remaining: number;
}

/**
 * Retries every queued report against the backend (one at a time). Each success
 * removes only that report; a failure records the error and is left queued, but
 * we continue to the next. Nothing is silently discarded.
 */
export async function syncPendingFeedback(
  auth: Auth,
  store: KeyValueStore | null,
): Promise<FeedbackSyncResult> {
  if (store === null) return { sent: 0, remaining: 0 };
  let sent = 0;
  for (const item of readAll(store)) {
    try {
      await auth.saveFeedback(item.insert);
    } catch (error) {
      recordFailure(store, item.id, error instanceof Error ? error.message : String(error));
      continue;
    }
    removePendingFeedback(store, item.id);
    sent += 1;
  }
  return { sent, remaining: readAll(store).length };
}

/** Returns a usable localStorage for the pending queue, or null when blocked. */
export function getFeedbackStore(): KeyValueStore | null {
  try {
    return (globalThis.localStorage as KeyValueStore | undefined) ?? null;
  } catch {
    return null;
  }
}
