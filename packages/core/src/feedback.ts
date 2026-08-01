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
  /**
   * Client-generated idempotency key (`feedback_reports.client_key`, UNIQUE).
   * Minted once per submission and reused across queue retries, so a retry
   * after an ambiguous failure can never create a duplicate report.
   */
  readonly client_key: string;
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

/**
 * Max message length, matching the `feedback_reports.message` CHECK
 * (char_length between 1 and 5000). Enforced at the input (textarea maxlength)
 * so an over-length message can never be submitted, permanently rejected by the
 * DB constraint, and then re-queued forever as a poison retry entry.
 */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 5000;

/** True when a report has a non-empty message (the only hard requirement). */
export function isValidFeedback(message: string): boolean {
  return message.trim().length > 0;
}

/**
 * A fresh idempotency key for one feedback submission. crypto.randomUUID with
 * a Math.random v4 fallback for ancient WebViews — uniqueness at "one key per
 * submission" scale, not cryptographic strength, is what matters here.
 */
export function newFeedbackClientKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Assembles the insert from the caller's input, folding the optional pieces into
 * the `context` jsonb. Debug events are attached only when the user opted in
 * (Include debug info). Pure — `message` is trimmed but otherwise unchanged.
 */
export function buildFeedbackInsert(
  input: FeedbackInput,
  clientKey: string = newFeedbackClientKey(),
): FeedbackInsert {
  const context: Record<string, unknown> = {};
  if (input.deckMode !== undefined) context["deckMode"] = input.deckMode;
  if (input.onboardingStep !== undefined) context["onboardingStep"] = input.onboardingStep;
  if (input.match !== undefined) context["match"] = input.match;
  if (input.reward !== undefined) context["reward"] = input.reward;
  if (input.includeDebug && input.debugEvents !== undefined && input.debugEvents.length > 0) {
    context["debugEvents"] = input.debugEvents.slice(-25);
  }
  return {
    client_key: clientKey,
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

/** localStorage key holding reports that permanently failed (dead-letter). */
export const DEAD_FEEDBACK_KEY = "euphoria.deadFeedback.v1";

/** Max delivery attempts for a transient failure before it is dead-lettered. */
export const FEEDBACK_MAX_ATTEMPTS = 8;

const BACKOFF_BASE_MS = 60_000; // 1 min after the first failure
const BACKOFF_MAX_MS = 6 * 3_600_000; // capped at 6 h

/** One queued report: the insert plus retry metadata. */
export interface PendingFeedback {
  readonly id: string;
  readonly insert: FeedbackInsert;
  readonly lastError: string;
  readonly attempts: number;
  readonly createdAt: string;
  /** Epoch ms before which this entry is not retried (exponential backoff). */
  readonly nextAttemptAt?: number;
}

/**
 * A report that will not be retried — either a permanent rejection or a
 * transient failure that exhausted its attempts. Preserved for diagnostics
 * (never silently discarded), with a safe, bounded failure detail only.
 */
export interface DeadFeedback {
  readonly id: string;
  readonly insert: FeedbackInsert;
  readonly attempts: number;
  readonly reason: "permanent" | "attempts-exhausted";
  /** Safe, truncated failure detail — never auth tokens or full response bodies. */
  readonly failure: { readonly code: string | null; readonly message: string };
  readonly createdAt: string;
  readonly deadLetteredAt: string;
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

/** Bumps attempts, records the (safe) error, and schedules the next retry. */
function recordFailure(
  store: KeyValueStore,
  id: string,
  error: string,
  nextAttemptAt: number,
): void {
  writeAll(
    store,
    readAll(store).map((f) =>
      f.id === id
        ? { ...f, attempts: f.attempts + 1, lastError: error, nextAttemptAt }
        : f,
    ),
  );
}

/**
 * Classifies a saveFeedback failure. **Permanent** = the same payload will
 * always be rejected (bad data, size/CHECK violations, unauthorized) — stop
 * retrying. **Transient** = recoverable (network, 5xx, rate limit, and crucially
 * a missing table / schema-cache miss, which resolves once the migration lands)
 * — retry with backoff up to the attempt cap.
 */
export function classifyFeedbackError(error: unknown): "permanent" | "transient" {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    // Postgres SQLSTATE: 23xxx integrity (not-null/fk/check), 22xxx data
    // exception (truncation), 42501 insufficient_privilege (RLS/grant) are
    // permanent. 23505 (unique) is handled as success upstream. Undefined-table
    // (42P01) and PostgREST schema-cache misses (PGRST*) stay transient by
    // omission — they clear once the table exists.
    if (
      (/^23/.test(code) && code !== "23505") ||
      /^22/.test(code) ||
      code === "42501"
    ) {
      return "permanent";
    }
  }
  return "transient";
}

/** Exponential backoff (ms) before the next retry, given attempts made so far. */
function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

/** A safe, size-bounded failure detail — never auth tokens or full bodies. */
function safeFailure(error: unknown): { code: string | null; message: string } {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? raw : null;
  const message = error instanceof Error ? error.message : String(error);
  return { code, message: message.slice(0, 300) };
}

function readDead(store: KeyValueStore): DeadFeedback[] {
  const raw = store.getItem(DEAD_FEEDBACK_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeadFeedback[]) : [];
  } catch {
    return [];
  }
}

function writeDead(store: KeyValueStore, items: readonly DeadFeedback[]): void {
  try {
    if (items.length === 0) store.removeItem(DEAD_FEEDBACK_KEY);
    else store.setItem(DEAD_FEEDBACK_KEY, JSON.stringify(items));
  } catch {
    /* storage full/blocked: skip the write, never throw */
  }
}

/** The dead-lettered reports, for a diagnostics view (never auto-retried). */
export function loadDeadLetterFeedback(store: KeyValueStore): DeadFeedback[] {
  return readDead(store);
}

/** How many reports have been dead-lettered. */
export function deadLetterFeedbackCount(store: KeyValueStore): number {
  return readDead(store).length;
}

/** Moves a pending entry to the dead-letter store, preserving a safe detail. */
function deadLetter(
  store: KeyValueStore,
  item: PendingFeedback,
  insert: FeedbackInsert,
  reason: DeadFeedback["reason"],
  error: unknown,
  now: number,
): void {
  writeDead(store, [
    ...readDead(store),
    {
      id: item.id,
      insert,
      attempts: item.attempts + 1,
      reason,
      failure: safeFailure(error),
      createdAt: item.createdAt,
      deadLetteredAt: new Date(now).toISOString(),
    },
  ]);
  removePendingFeedback(store, item.id);
}

/** Result of a retry pass over the queue. */
export interface FeedbackSyncResult {
  readonly sent: number;
  readonly remaining: number;
  readonly deadLettered: number;
}

/**
 * Retries every eligible queued report against the backend (one at a time),
 * with bounded, safe retry handling:
 *
 *   - Backoff: an entry whose `nextAttemptAt` hasn't arrived is skipped.
 *   - Success removes only that report.
 *   - A **permanent** failure (bad data / size / CHECK / unauthorized) is moved
 *     straight to the dead-letter store — never retried again.
 *   - A **transient** failure is re-queued with an exponential backoff until it
 *     reaches FEEDBACK_MAX_ATTEMPTS, then it too is dead-lettered.
 *
 * Nothing is ever silently discarded — exhausted/permanent reports are preserved
 * in the dead-letter store with a safe, bounded failure detail (no tokens/bodies).
 * `now` is injectable for deterministic tests.
 */
export async function syncPendingFeedback(
  auth: Auth,
  store: KeyValueStore | null,
  now: number = Date.now(),
): Promise<FeedbackSyncResult> {
  if (store === null) return { sent: 0, remaining: 0, deadLettered: 0 };
  let sent = 0;
  let deadLettered = 0;
  for (const item of readAll(store)) {
    // Backoff: not yet time to retry this entry.
    if (typeof item.nextAttemptAt === "number" && item.nextAttemptAt > now) continue;

    // Reports queued before idempotency keys existed lack client_key: mint one
    // and persist it BEFORE sending, so every retry of this item reuses it.
    let insert = item.insert;
    if (typeof (insert as Partial<FeedbackInsert>).client_key !== "string") {
      insert = { ...insert, client_key: newFeedbackClientKey() };
      writeAll(
        store,
        readAll(store).map((f) => (f.id === item.id ? { ...f, insert } : f)),
      );
    }
    try {
      await auth.saveFeedback(insert);
    } catch (error) {
      const attempts = item.attempts + 1;
      if (classifyFeedbackError(error) === "permanent") {
        deadLetter(store, item, insert, "permanent", error, now);
        deadLettered += 1;
      } else if (attempts >= FEEDBACK_MAX_ATTEMPTS) {
        deadLetter(store, item, insert, "attempts-exhausted", error, now);
        deadLettered += 1;
      } else {
        recordFailure(store, item.id, safeFailure(error).message, now + backoffMs(attempts));
      }
      continue;
    }
    removePendingFeedback(store, item.id);
    sent += 1;
  }
  return { sent, remaining: readAll(store).length, deadLettered };
}

/** Returns a usable localStorage for the pending queue, or null when blocked. */
export function getFeedbackStore(): KeyValueStore | null {
  try {
    return (globalThis.localStorage as KeyValueStore | undefined) ?? null;
  } catch {
    return null;
  }
}
