/**
 * Pending reward-claim queue for SIGNED-IN SUPABASE accounts. When a reward's
 * owned_cards / reward_events save fails, we must neither silently lose it nor
 * pretend it fully succeeded. Instead the chosen reward is parked here in
 * localStorage as a single pending claim and retried later — Supabase remains the
 * one permanent source of truth for owned cards (this is a retry buffer, NOT a
 * second owned-card store).
 *
 * Demo/local-mode accounts never use this (their saveReward can't fail), so their
 * behavior is unchanged.
 */
import type { Auth, AuthSession } from "./auth";
import type { OwnedCardInsert, RewardEventInsert } from "./rewards";
import type { KeyValueStore } from "./signup";

/** localStorage key holding the single pending claim. Versioned. */
export const PENDING_REWARD_KEY = "euphoria.pendingReward.v1";

/** A reward chosen but not yet persisted to Supabase, awaiting retry. */
export interface PendingRewardClaim {
  /** Scopes the claim to the signed-in user (no cross-account sync). */
  readonly userId: string;
  /** The exact owned_cards insert to replay. */
  readonly owned: OwnedCardInsert;
  /** The exact reward_events insert to replay. */
  readonly event: RewardEventInsert;
  /** The milestone this reward was earned at (locks the milestone's choice). */
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

/** Fields a caller supplies; counters/timestamps are stamped here. */
export interface PendingRewardInput {
  readonly userId: string;
  readonly owned: OwnedCardInsert;
  readonly event: RewardEventInsert;
  readonly milestone: number;
  readonly cardName: string;
  readonly lastError: string;
}

/** Narrows an unknown parsed value to a PendingRewardClaim, or null. */
export function coercePendingClaim(value: unknown): PendingRewardClaim | null {
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
  return {
    userId: v["userId"],
    owned: owned as OwnedCardInsert,
    event: event as RewardEventInsert,
    milestone: v["milestone"],
    cardName: typeof v["cardName"] === "string" ? v["cardName"] : "your reward",
    lastError: typeof v["lastError"] === "string" ? v["lastError"] : "",
    attempts: typeof v["attempts"] === "number" ? v["attempts"] : 1,
    createdAt: typeof v["createdAt"] === "string" ? v["createdAt"] : "",
    updatedAt: typeof v["updatedAt"] === "string" ? v["updatedAt"] : "",
  };
}

/**
 * Writes (or overwrites) the pending claim. Returns false if storage is
 * unavailable/full — the caller then treats the claim as a hard failure so the
 * reward is never quietly dropped.
 */
export function savePendingClaim(
  store: KeyValueStore,
  input: PendingRewardInput,
  now: Date = new Date(),
): boolean {
  const stamp = now.toISOString();
  const record: PendingRewardClaim = {
    ...input,
    attempts: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  try {
    store.setItem(PENDING_REWARD_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Loads the pending claim for `userId`, or null if absent/corrupt/other user's. */
export function loadPendingClaim(
  store: KeyValueStore,
  userId: string,
): PendingRewardClaim | null {
  const raw = store.getItem(PENDING_REWARD_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const claim = coercePendingClaim(parsed);
  if (claim === null || claim.userId !== userId) return null;
  return claim;
}

/** Removes the pending claim (call once it has synced). */
export function clearPendingClaim(store: KeyValueStore): void {
  try {
    store.removeItem(PENDING_REWARD_KEY);
  } catch {
    /* best-effort */
  }
}

/** Bumps the attempt counter and records the latest failure (never discards). */
export function recordRetryFailure(
  store: KeyValueStore,
  userId: string,
  error: string,
  now: Date = new Date(),
): void {
  const claim = loadPendingClaim(store, userId);
  if (claim === null) return;
  const next: PendingRewardClaim = {
    ...claim,
    attempts: claim.attempts + 1,
    lastError: error,
    updatedAt: now.toISOString(),
  };
  try {
    store.setItem(PENDING_REWARD_KEY, JSON.stringify(next));
  } catch {
    /* best-effort: keep the existing claim rather than lose it */
  }
}

/**
 * Retries a pending claim against the live backend. No-op for demo/local
 * accounts (they never queue). On success the claim is cleared and `true` is
 * returned (the caller should reload owned cards); on failure the attempt is
 * recorded and `false` is returned, leaving the claim in place.
 */
export async function syncPendingReward(
  auth: Auth,
  session: AuthSession,
  store: KeyValueStore | null,
): Promise<boolean> {
  if (store === null || !auth.isRemote) return false;
  const claim = loadPendingClaim(store, session.userId);
  if (claim === null) return false;
  try {
    await auth.saveReward(session, claim.owned, claim.event);
  } catch (error) {
    recordRetryFailure(
      store,
      session.userId,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
  clearPendingClaim(store);
  return true;
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
