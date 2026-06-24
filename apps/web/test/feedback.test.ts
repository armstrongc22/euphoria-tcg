/**
 * Pure feedback logic: the insert builder (context folding, trimming, debug-event
 * capping), the README-schema shape, message validation, and the localStorage
 * pending queue + retry/sync that guarantees feedback is never silently dropped.
 */
import { describe, expect, it, vi } from "vitest";
import type { Auth } from "../src/auth";
import type { KeyValueStore } from "../src/signup";
import {
  buildFeedbackInsert,
  isValidFeedback,
  loadPendingFeedback,
  pendingFeedbackCount,
  removePendingFeedback,
  savePendingFeedback,
  syncPendingFeedback,
  type FeedbackInput,
  type FeedbackInsert,
} from "../src/feedback";

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

  it("matches the README feedback_reports schema (exact column set)", () => {
    const insert = buildFeedbackInsert(BASE);
    expect(Object.keys(insert).sort()).toEqual([...SCHEMA_COLUMNS].sort());
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
    expect(result).toEqual({ sent: 2, remaining: 0 });
    expect(pendingFeedbackCount(store)).toBe(0);
  });

  it("keeps a report queued and records the error when the send fails", async () => {
    const store = memoryStore();
    savePendingFeedback(store, sample, "first error");
    const save = vi.fn().mockRejectedValue(new Error("still offline"));
    const result = await syncPendingFeedback(fakeAuth(save), store);
    expect(result).toEqual({ sent: 0, remaining: 1 });
    const [parked] = loadPendingFeedback(store);
    expect(parked!.lastError).toBe("still offline");
    expect(parked!.attempts).toBe(2);
  });

  it("is a no-op with no store", async () => {
    const save = vi.fn();
    expect(await syncPendingFeedback(fakeAuth(save), null)).toEqual({
      sent: 0,
      remaining: 0,
    });
    expect(save).not.toHaveBeenCalled();
  });
});
