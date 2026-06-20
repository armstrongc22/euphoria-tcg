/**
 * Pending reward-claim QUEUE for SIGNED-IN SUPABASE accounts. When a reward's
 * owned_cards / reward_events save fails, we must neither silently lose it nor
 * pretend it fully succeeded. Instead the chosen reward is appended to a queue in
 * localStorage and retried later — Supabase remains the one permanent source of
 * truth for owned cards (this is a retry buffer, NOT a second owned-card store).
 *
 * Multiple failed claims are all preserved (one per milestone). A new failed
 * claim appends; it never overwrites an older one. At most one claim per
 * (user, milestone) is kept — a duplicate is dropped with a debug reason.
 *
 * Demo/local-mode accounts never use this (their saveReward can't fail), so their
 * behavior is unchanged.
 */
import { logDebug } from "./debug-log";
import type { Auth, AuthSession } from "./auth";
import type { OwnedCardInsert, RewardEventInsert } from "./rewards";
import type { KeyValueStore } from "./signup";

/** localStorage key holding the queue (a JSON array of claims). Versioned. */
export const PENDING_REWARD_KEY = "euphoria.pendingReward.v1";

/** A reward chosen but not yet persisted to Supabase, awaiting retry. */
export interface PendingRewardClaim {
  /** Stable unique id: `${userId}:${milestone}:${slug}:${createdAt}`. */
  readonly id: string;
  /** Scopes the claim to the signed-in user (no cross-account sync). */
  readonly userId: string;
  /** The exact owned_cards insert to replay. */
  readonly owned: OwnedCardInsert;
  /** The exact reward_events insert to replay. */
  readonly event: RewardEventInsert;
  /** The milestone this reward was earned at (one claim per milestone). */
  readonly milestone: number;
  /** The chosen card's display name, for the pending UI. */
  readonly cardName: string;
  /** The most recent failure message (why it hasn't synced). */
  readonly lastError: string;
  /** How many times a sync has been attempted (>= 1 after the first failure). */
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Fields a caller supplies; id/counters/timestamps are stamped here. */
export interface PendingRewardInput {
  readonly userId: string;
  readonly owned: OwnedCardInsert;
  readonly event: RewardEventInsert;
  readonly milestone: number;
  readonly cardName: string;
  readonly lastError: string;
}

/** Result of appending a claim to the queue. */
export type AppendResult =
  | { readonly status: "added" }
  | { readonly status: "duplicate" } // already queued for this user+milestone
  | { readonly status: "error" }; //   couldn't persist (storage blocked/full)

function makeId(input: PendingRewardInput, createdAt: string): string {
  return `${input.userId}:${input.milestone}:${input.owned.card_slug}:${createdAt}`;
}

/** Narrows an unknown value to a PendingRewardClaim, supplying an id if missing. */
function coerceClaim(value: unknown): PendingRewardClaim | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const owned = v["owned"];
  const event = v["event"];
  if (typeof v["userId"] !== "string" || v["userId"].length === 0) return null;
  if (typeof owned !== "object" || owned === null) return null;
  if (typeof (owned as OwnedCardInsert).card_slug !== "string") return null;
  if (typeof event !== "object" || event === null) return null;
  if (typeof (event as RewardEventInsert).chosen_slug !== "string") return null;
  if (typeof v["milestone"] !== "number") return null;
  const userId = v["userId"];
  const milestone = v["milestone"];
  const createdAt = typeof v["createdAt"] === "string" ? v["createdAt"] : "";
  const ownedTyped = owned as OwnedCardInsert;
  return {
    id:
      typeof v["id"] === "string" && v["id"].length > 0
        ? v["id"]
        : `${userId}:${milestone}:${ownedTyped.card_slug}:${createdAt}`,
    userId,
    owned: ownedTyped,
    event: event as RewardEventInsert,
    milestone,
    cardName: typeof v["cardName"] === "string" ? v["cardName"] : "your reward",
    lastError: typeof v["lastError"] === "string" ? v["lastError"] : "",
    attempts: typeof v["attempts"] === "number" ? v["attempts"] : 1,
    createdAt,
    updatedAt: typeof v["updatedAt"] === "string" ? v["updatedAt"] : createdAt,
  };
}

/** Reads the whole queue (all users), dropping corrupt entries. Never throws. */
function readAll(store: KeyValueStore): PendingRewardClaim[] {
  const raw = store.getItem(PENDING_REWARD_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // Tolerate a legacy single-object shape by wrapping it.
  const arr = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && "owned" in parsed
      ? [parsed]
      : [];
  return arr
    .map(coerceClaim)
    .filter((c): c is PendingRewardClaim => c !== null);
}

/** Writes the whole queue. Returns false when storage is blocked/full. */
function writeAll(store: KeyValueStore, claims: readonly PendingRewardClaim[]): boolean {
  try {
    if (claims.length === 0) store.removeItem(PENDING_REWARD_KEY);
    else store.setItem(PENDING_REWARD_KEY, JSON.stringify(claims));
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends a failed claim to the queue. A claim already queued for the same
 * (user, milestone) is NOT duplicated — the earliest is kept and we report
 * "duplicate" (still effectively pending). "error" means storage couldn't hold
 * it, so the caller treats the reward as a hard failure rather than losing it.
 */
export function appendPendingClaim(
  store: KeyValueStore,
  input: PendingRewardInput,
  now: Date = new Date(),
): AppendResult {
  const all = readAll(store);
  if (all.some((c) => c.userId === input.userId && c.milestone === input.milestone)) {
    logDebug("pendingRewardDuplicate", {
      milestone: input.milestone,
      slug: input.owned.card_slug,
    });
    return { status: "duplicate" };
  }
  const createdAt = now.toISOString();
  const claim: PendingRewardClaim = {
    id: makeId(input, createdAt),
    ...input,
    attempts: 1,
    createdAt,
    updatedAt: createdAt,
  };
  all.push(claim);
  return writeAll(store, all) ? { status: "added" } : { status: "error" };
}

/**
 * The user's pending claims, earliest first and de-duplicated by milestone
 * (keeping the earliest). A dropped duplicate is flagged via the debug log
 * rather than silently discarded.
 */
export function loadPendingClaims(
  store: KeyValueStore,
  userId: string,
): PendingRewardClaim[] {
  const mine = readAll(store)
    .filter((c) => c.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Set<number>();
  const out: PendingRewardClaim[] = [];
  for (const claim of mine) {
    if (seen.has(claim.milestone)) {
      logDebug("pendingRewardDuplicateDropped", {
        milestone: claim.milestone,
        id: claim.id,
      });
      continue;
    }
    seen.add(claim.milestone);
    out.push(claim);
  }
  return out;
}

/** How many pending claims the user has (for the "N rewards pending" banner). */
export function pendingClaimCount(store: KeyValueStore, userId: string): number {
  return loadPendingClaims(store, userId).length;
}

/** Removes one claim by id (after it syncs), preserving the rest. */
export function removePendingClaim(store: KeyValueStore, id: string): void {
  writeAll(
    store,
    readAll(store).filter((c) => c.id !== id),
  );
}

/** Bumps a specific claim's attempt counter and records its latest error. */
export function recordRetryFailure(
  store: KeyValueStore,
  id: string,
  error: string,
  now: Date = new Date(),
): void {
  writeAll(
    store,
    readAll(store).map((c) =>
      c.id === id
        ? { ...c, attempts: c.attempts + 1, lastError: error, updatedAt: now.toISOString() }
        : c,
    ),
  );
}

/** Clears the user's pending claims (or the whole queue when no user given). */
export function clearPendingClaims(store: KeyValueStore, userId?: string): void {
  if (userId === undefined) {
    try {
      store.removeItem(PENDING_REWARD_KEY);
    } catch {
      /* best-effort */
    }
    return;
  }
  writeAll(
    store,
    readAll(store).filter((c) => c.userId !== userId),
  );
}

/** The outcome of a retry pass over the queue. */
export interface SyncResult {
  /** How many claims synced this pass. */
  readonly synced: number;
  /** How many claims remain queued afterwards. */
  readonly remaining: number;
}

/**
 * Retries the user's pending claims one at a time (earliest first). No-op for
 * demo/local accounts (they never queue). Each success removes only that claim;
 * the first failure records its error and stops the pass, leaving every
 * still-unsynced claim intact (a later mount/startup retries again).
 */
export async function syncPendingRewards(
  auth: Auth,
  session: AuthSession,
  store: KeyValueStore | null,
): Promise<SyncResult> {
  if (store === null || !auth.isRemote) {
    return { synced: 0, remaining: 0 };
  }
  const queue = loadPendingClaims(store, session.userId);
  let synced = 0;
  for (const claim of queue) {
    try {
      await auth.saveReward(session, claim.owned, claim.event);
    } catch (error) {
      recordRetryFailure(
        store,
        claim.id,
        error instanceof Error ? error.message : String(error),
      );
      break; // stop at the first failure; the rest stay queued for next time
    }
    removePendingClaim(store, claim.id);
    synced += 1;
  }
  return { synced, remaining: loadPendingClaims(store, session.userId).length };
}

/** Returns a usable localStorage for the pending queue, or null if blocked. */
export function getPendingStore(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage as KeyValueStore | undefined;
    if (!ls) return null;
    const probe = "__euphoria_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
