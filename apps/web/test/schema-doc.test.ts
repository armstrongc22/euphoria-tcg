/**
 * Guards the Supabase schema documentation: the README's verification block must
 * list every column the app writes/reads for owned_cards and reward_events, so a
 * deploy can be checked against it. Pure file read — no DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readme(): string {
  for (const p of ["apps/web/README.md", "README.md"]) {
    try {
      return readFileSync(resolve(process.cwd(), p), "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("README.md not found from cwd " + process.cwd());
}

describe("README schema verification block", () => {
  const text = readme();

  it("documents every required owned_cards column", () => {
    for (const col of [
      "id",
      "user_id",
      "card_slug",
      "card_name",
      "card_type",
      "faction",
      "source",
      "created_at",
    ]) {
      expect(text).toContain(col);
    }
    // The verification block explicitly names owned_cards' required columns.
    expect(text).toMatch(/owned_cards.*must include/i);
  });

  it("documents every required reward_events column", () => {
    for (const col of [
      "milestone",
      "tier",
      "chosen_slug",
      "option_slugs",
      "player_faction",
      "user_id",
      "created_at",
    ]) {
      expect(text).toContain(col);
    }
    expect(text).toMatch(/reward_events.*must include/i);
  });

  it("includes a read-only schema verification query", () => {
    expect(text).toContain("information_schema.columns");
    expect(text).toContain("pg_policies");
  });

  it("documents the DELETE policies the starter-switch reset needs", () => {
    expect(text).toContain("owned_cards_delete_own");
    expect(text).toContain("reward_events_delete_own");
    expect(text).toContain("match_history_delete_own");
  });
});
