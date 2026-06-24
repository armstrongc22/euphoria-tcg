/**
 * Auth-backend persistence for feedback. The Supabase backend inserts the report
 * straight into `feedback_reports` (and surfaces an RLS/insert error by throwing);
 * the localStorage demo backend keeps it on-device so the flow works offline.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalAuth, createSupabaseAuth, LOCAL_FEEDBACK_KEY } from "../src/auth";
import { buildFeedbackInsert, type FeedbackInsert } from "../src/feedback";
import type { KeyValueStore } from "../src/signup";

const INSERT: FeedbackInsert = buildFeedbackInsert({
  type: "bug",
  message: "broken",
  userId: "user-1",
  email: null,
  view: "account",
  build: "b1",
  userAgent: "jsdom",
  mobile: false,
  selectedFaction: "Dwarf",
  includeDebug: false,
});

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("createSupabaseAuth.saveFeedback", () => {
  it("inserts the report into feedback_reports", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => {
        expect(table).toBe("feedback_reports");
        return { insert };
      }),
    } as unknown as SupabaseClient;
    const auth = createSupabaseAuth(client);
    await expect(auth.saveFeedback(INSERT)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith(INSERT);
  });

  it("throws when the insert is rejected (e.g. missing INSERT RLS)", async () => {
    const client = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: "permission denied" } }),
      }),
    } as unknown as SupabaseClient;
    const auth = createSupabaseAuth(client);
    await expect(auth.saveFeedback(INSERT)).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});

describe("createLocalAuth.saveFeedback", () => {
  it("appends the report to local storage (demo mode)", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.saveFeedback(INSERT);
    await auth.saveFeedback(INSERT);
    const raw = store.getItem(LOCAL_FEEDBACK_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveLength(2);
  });
});
