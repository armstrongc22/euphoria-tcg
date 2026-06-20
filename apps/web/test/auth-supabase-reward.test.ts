/**
 * createSupabaseAuth.saveReward read-back verification. A missing owned_cards
 * SELECT RLS policy lets the INSERT succeed but returns zero rows on read, so a
 * claimed reward silently never appears. saveReward must treat that as a failure
 * (throw) so the claim queues + the retry banner shows. Uses a tiny fake Supabase
 * client — no network.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuth } from "../src/auth";
import type { OwnedCardInsert, RewardEventInsert } from "../src/rewards";

const OWNED: OwnedCardInsert = {
  user_id: "user-1",
  card_slug: "fafnir",
  card_name: "Fafnir",
  faction: "Dwarf",
  card_type: "Warrior",
  source: "reward",
};
const EVENT: RewardEventInsert = {
  user_id: "user-1",
  player_faction: "Dwarf",
  chosen_slug: "fafnir",
  option_slugs: ["fafnir"],
  milestone: 5,
  tier: 1,
};
const SESSION = { userId: "user-1", email: "p@example.com" };

interface FakeConfig {
  ownedInsertError?: { message: string } | null;
  eventInsertError?: { message: string } | null;
  verifyData?: unknown[];
  verifyError?: { message: string } | null;
}

/** A minimal Supabase client stub covering the insert + read-back select chain. */
function fakeClient(cfg: FakeConfig): SupabaseClient {
  return {
    from(table: string) {
      return {
        insert: (_row: unknown) =>
          Promise.resolve({
            error:
              table === "owned_cards"
                ? (cfg.ownedInsertError ?? null)
                : (cfg.eventInsertError ?? null),
          }),
        select: (_cols: string) => {
          const q = {
            eq: () => q,
            order: () => q,
            limit: () =>
              Promise.resolve({
                data: cfg.verifyData ?? [],
                error: cfg.verifyError ?? null,
              }),
          };
          return q;
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("createSupabaseAuth.saveReward — read-back verification", () => {
  it("resolves when the owned card is readable back after insert", async () => {
    const auth = createSupabaseAuth(fakeClient({ verifyData: [{ card_slug: "fafnir" }] }));
    await expect(auth.saveReward(SESSION, OWNED, EVENT)).resolves.toBeUndefined();
  });

  it("throws when the insert succeeds but the row is NOT readable (missing SELECT RLS)", async () => {
    const auth = createSupabaseAuth(fakeClient({ verifyData: [] }));
    await expect(auth.saveReward(SESSION, OWNED, EVENT)).rejects.toThrow(
      /could not be read back|SELECT policy/i,
    );
  });

  it("throws on a hard insert error (e.g. missing INSERT RLS)", async () => {
    const auth = createSupabaseAuth(
      fakeClient({ ownedInsertError: { message: "permission denied" } }),
    );
    await expect(auth.saveReward(SESSION, OWNED, EVENT)).rejects.toThrow(/permission denied/);
  });

  it("throws when the read-back query itself errors", async () => {
    const auth = createSupabaseAuth(
      fakeClient({ verifyError: { message: "relation missing" } }),
    );
    await expect(auth.saveReward(SESSION, OWNED, EVENT)).rejects.toThrow(/relation missing/);
  });
});
