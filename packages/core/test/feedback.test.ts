/**
 * Pure feedback logic: the insert builder (context folding, trimming, debug-event
 * capping), the README-schema shape, message validation, and the localStorage
 * pending queue + retry/sync that guarantees feedback is never silently dropped.
 */
import { describe, expect, it, vi } from "vitest";
import type { Auth } from "../src/auth";
import type { KeyValueStore } from "@euphoria/core/signup";
import {
  buildFeedbackInsert,
  classifyFeedbackError,
  deadLetterFeedbackCount,
  FEEDBACK_MAX_ATTEMPTS,
  isValidFeedback,
  loadDeadLetterFeedback,
  loadPendingFeedback,
  pendingFeedbackCount,
  removePendingFeedback,
  savePendingFeedback,
  syncPendingFeedback,
  type FeedbackInput,
  type FeedbackInsert,
} from "../src/feedback";

/** Builds a rejection that looks like a real Postgres/Supabase error. */
function pgError(code: string, message = "db error"): Error {
  return Object.assign(new Error(message), { code });
}
const HOUR = 3_600_000;

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const BASE: FeedbackInput = {
  type: "bug",
  message: "  it broke  ",
  userId: "user-1",
  email: null,
  view: "live-match",
  build: "abc123",
  userAgent: "jsdom",
  mobile: true,
  selectedFaction: "Dwarf",
  includeDebug: false,
};

/** The exact column set the README `feedback_reports` table defines. */
const SCHEMA_COLUMNS = [
  "client_key",
  "user_id",
  "email",
  "type",
  "message",
  "view",
  "build",
  "user_agent",
  "mobile",
  "selected_faction",
  "context",
] as const;

function fakeAuth(saveFeedback: Auth["saveFeedback"]): Auth {
  return { saveFeedback } as unknown as Auth;
}

describe("buildFeedbackInsert", () => {
  it("carries the top-level debug context and trims the message", () => {
    const insert = buildFeedbackInsert(BASE);
    expect(insert.user_id).toBe("user-1");
    expect(insert.build).toBe("abc123");
    expect(insert.view).toBe("live-match");
    expect(insert.user_agent).toBe("jsdom");
    expect(insert.mobile).toBe(true);
    expect(insert.selected_faction).toBe("Dwarf");
    expect(insert.message).toBe("it broke");
  });

  it("matches the feedback_reports migration schema (exact column set)", () => {
    const insert = buildFeedbackInsert(BASE);
    expect(Object.keys(insert).sort()).toEqual([...SCHEMA_COLUMNS].sort());
  });

  it("mints a fresh idempotency key per submission and honors an injected one", () => {
    const a = buildFeedbackInsert(BASE);
    const b = buildFeedbackInsert(BASE);
    expect(a.client_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.client_key).not.toBe(b.client_key);
    expect(buildFeedbackInsert(BASE, "fixed-key").client_key).toBe("fixed-key");
  });

  it("normalizes an empty contact email to null but keeps a real one", () => {
    expect(buildFeedbackInsert({ ...BASE, email: "   " }).email).toBeNull();
    expect(buildFeedbackInsert({ ...BASE, email: " a@b.co " }).email).toBe("a@b.co");
  });

  it("folds the compact match/reward/onboarding context into the jsonb blob", () => {
    const insert = buildFeedbackInsert({
      ...BASE,
      deckMode: "Custom Deck",
      onboardingStep: "play-match",
      match: { turn: 3, phase: "battle" },
      reward: { wins: 4 },
    });
    expect(insert.context).toEqual({
      deckMode: "Custom Deck",
      onboardingStep: "play-match",
      match: { turn: 3, phase: "battle" },
      reward: { wins: 4 },
    });
  });

  it("attaches debug events only when includeDebug is set, capped to the last 25", () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ i }));
    expect(buildFeedbackInsert({ ...BASE, debugEvents: events }).context.debugEvents).toBeUndefined();
    const withDebug = buildFeedbackInsert({
      ...BASE,
      includeDebug: true,
      debugEvents: events,
    });
    const attached = withDebug.context.debugEvents as unknown[];
    expect(attached).toHaveLength(25);
    expect(attached[0]).toEqual({ i: 15 });
  });
});

describe("isValidFeedback", () => {
  it("rejects an empty / whitespace-only message", () => {
    expect(isValidFeedback("")).toBe(false);
    expect(isValidFeedback("   ")).toBe(false);
    expect(isValidFeedback("hi")).toBe(true);
  });
});

describe("pending feedback queue", () => {
  const sample: FeedbackInsert = buildFeedbackInsert(BASE);

  it("parks a report and counts/loads it back", () => {
    const store = memoryStore();
    expect(savePendingFeedback(store, sample, "network down")).toBe(true);
    expect(pendingFeedbackCount(store)).toBe(1);
    const [parked] = loadPendingFeedback(store);
    expect(parked!.insert.message).toBe("it broke");
    expect(parked!.lastError).toBe("network down");
    expect(parked!.attempts).toBe(1);
  });

  it("removes a report by id", () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "x");
    const [parked] = loadPendingFeedback(store);
    removePendingFeedback(store, parked!.id);
    expect(pendingFeedbackCount(store)).toBe(0);
  });
});

describe("syncPendingFeedback", () => {
  const sample: FeedbackInsert = buildFeedbackInsert(BASE);

  it("sends each queued report and clears it on success", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "earlier failure");
    savePendingFeedback(store, sample, "earlier failure");
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await syncPendingFeedback(fakeAuth(save), store);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, remaining: 0, deadLettered: 0 });
    expect(pendingFeedbackCount(store)).toBe(0);
  });

  it("keeps a transient failure queued with backoff and records the error", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "first error");
    const save = vi.fn().mockRejectedValue(new Error("still offline")); // no code => transient
    const result = await syncPendingFeedback(fakeAuth(save), store, 1_000);
    expect(result).toEqual({ sent: 0, remaining: 1, deadLettered: 0 });
    const [parked] = loadPendingFeedback(store);
    expect(parked!.lastError).toBe("still offline");
    expect(parked!.attempts).toBe(2);
    expect(parked!.nextAttemptAt).toBeGreaterThan(1_000); // backoff scheduled
    // Immediately retrying (before backoff elapses) skips the entry.
    await syncPendingFeedback(fakeAuth(save), store, 1_001);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("is a no-op with no store", async () => {
    const save = vi.fn();
    expect(await syncPendingFeedback(fakeAuth(save), null)).toEqual({
      sent: 0,
      remaining: 0,
      deadLettered: 0,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("retries a transient failure after backoff, then succeeds and clears it", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "offline");
    let call = 0;
    const save = vi.fn().mockImplementation(() => {
      call += 1;
      return call === 1 ? Promise.reject(new Error("network")) : Promise.resolve(undefined);
    });
    await syncPendingFeedback(fakeAuth(save), store, 0); // fails, backoff set
    expect(pendingFeedbackCount(store)).toBe(1);
    const result = await syncPendingFeedback(fakeAuth(save), store, HOUR); // past backoff
    expect(save).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ sent: 1, remaining: 0 });
    expect(pendingFeedbackCount(store)).toBe(0);
  });

  it("reuses the same idempotency key across retries (duplicate-proof)", async () => {
    const store = memoryStore();
    const { client_key: _dropped, ...legacy } = sample; // legacy: no client_key
    savePendingFeedback(store, legacy as FeedbackInsert, "old failure");
    const seen: string[] = [];
    const save = vi.fn().mockImplementation((insert: FeedbackInsert) => {
      seen.push(insert.client_key);
      return seen.length === 1 ? Promise.reject(new Error("flaky")) : Promise.resolve(undefined);
    });
    await syncPendingFeedback(fakeAuth(save), store, 0);
    const [parked] = loadPendingFeedback(store);
    expect(parked!.insert.client_key).toBe(seen[0]); // minted + persisted
    await syncPendingFeedback(fakeAuth(save), store, HOUR);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]); // same key on retry
    expect(pendingFeedbackCount(store)).toBe(0);
  });

  it("dead-letters a permanent rejection immediately (no repeated retries)", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "queued");
    const save = vi.fn().mockRejectedValue(pgError("23514", "message too long")); // CHECK violation
    const result = await syncPendingFeedback(fakeAuth(save), store, 0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sent: 0, remaining: 0, deadLettered: 1 });
    expect(pendingFeedbackCount(store)).toBe(0);
    const [dead] = loadDeadLetterFeedback(store);
    expect(dead!.reason).toBe("permanent");
    expect(dead!.failure.code).toBe("23514");
    // Not retried on subsequent reconnects.
    await syncPendingFeedback(fakeAuth(save), store, 10 * HOUR);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a transient failure once the attempt cap is reached", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "queued");
    const save = vi.fn().mockRejectedValue(pgError("42P01", "table not found")); // transient
    let now = 0;
    for (let i = 0; i < FEEDBACK_MAX_ATTEMPTS + 2 && pendingFeedbackCount(store) > 0; i++) {
      now += 10 * HOUR; // always past backoff
      await syncPendingFeedback(fakeAuth(save), store, now);
    }
    expect(save).toHaveBeenCalledTimes(FEEDBACK_MAX_ATTEMPTS - 1);
    expect(pendingFeedbackCount(store)).toBe(0);
    expect(deadLetterFeedbackCount(store)).toBe(1);
    expect(loadDeadLetterFeedback(store)[0]!.reason).toBe("attempts-exhausted");
    // Dead-lettered => not retried again.
    await syncPendingFeedback(fakeAuth(save), store, 100 * HOUR);
    expect(save).toHaveBeenCalledTimes(FEEDBACK_MAX_ATTEMPTS - 1);
  });

  it("dead-letters a malformed legacy entry (no client_key + permanent error) safely", async () => {
    const store = memoryStore();
    const { client_key: _dropped, ...legacy } = sample;
    savePendingFeedback(store, legacy as FeedbackInsert, "legacy");
    const save = vi.fn().mockRejectedValue(pgError("23502", "user_id null")); // not-null violation
    await syncPendingFeedback(fakeAuth(save), store, 0);
    expect(pendingFeedbackCount(store)).toBe(0);
    const [dead] = loadDeadLetterFeedback(store);
    expect(dead!.reason).toBe("permanent");
    // The dead-letter got a client_key minted before the attempt, and stores no
    // tokens/bodies — only a safe code + short message.
    expect(dead!.insert.client_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(dead!.failure).toEqual({ code: "23502", message: "user_id null" });
  });
});

describe("classifyFeedbackError", () => {
  it("treats integrity/data/authorization errors as permanent", () => {
    for (const c of ["23514", "23502", "23503", "22001", "42501"]) {
      expect(classifyFeedbackError({ code: c })).toBe("permanent");
    }
  });
  it("treats missing-table, schema-cache, unique, network as transient", () => {
    expect(classifyFeedbackError({ code: "42P01" })).toBe("transient"); // table not created yet
    expect(classifyFeedbackError({ code: "PGRST205" })).toBe("transient"); // schema cache miss
    expect(classifyFeedbackError({ code: "23505" })).toBe("transient"); // handled as success upstream
    expect(classifyFeedbackError(new Error("fetch failed"))).toBe("transient");
  });
});
