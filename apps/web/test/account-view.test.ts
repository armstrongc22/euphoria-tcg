/**
 * @vitest-environment jsdom
 *
 * Account page rendering. Exercises the pure renderAccount builder (email,
 * faction, starter deck, progression + rewards placeholders, sign out) and the
 * mountAccount loader against the localStorage demo backend.
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { renderAccount, mountAccount, type AccountInfo } from "../src/account-view";
import { createLocalAuth, type Auth, type AuthSession } from "../src/auth";
import type { MatchHistoryInsert } from "../src/match-history";
import { deckCardCount, getRecipe } from "../src/starter";
import type { KeyValueStore } from "../src/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("renderAccount", () => {
  const info: AccountInfo = {
    email: "player@example.com",
    faction: "Sonic",
    isRemote: true,
  };

  it("shows the email and selected faction", () => {
    const el = renderAccount(info, cards, () => {});
    const text = el.textContent ?? "";
    expect(text).toContain("player@example.com");
    expect(text).toContain("Sonic");
  });

  it("shows the chosen starter deck derived from the recipe", () => {
    const el = renderAccount(info, cards, () => {});
    const count = deckCardCount(getRecipe("Sonic"));
    expect(el.textContent).toContain(`Sonic Starter Deck · ${count} cards`);
  });

  it("renders the beta progression placeholder", () => {
    const el = renderAccount(info, cards, () => {});
    expect(el.querySelector(".account__progression")?.textContent?.toLowerCase())
      .toContain("coming soon");
  });

  it("shows the empty reward-cards inventory when nothing is owned", () => {
    const el = renderAccount(info, cards, () => {});
    const rewards = el.querySelector(".account__rewards");
    expect(rewards?.textContent).toContain("Reward cards");
    expect(rewards?.textContent?.toLowerCase()).toContain("no reward cards yet");
  });

  it("lists owned reward cards with copy counts", () => {
    const el = renderAccount(
      {
        ...info,
        inventory: { total: 3, unique: 2, byType: { Warrior: 2, Weapon: 1 } },
        owned: [
          { slug: "fafnir", name: "Fafnir", count: 1 },
          { slug: "titan", name: "Titan", count: 2 },
        ],
      },
      cards,
      () => {},
    );
    const rewards = el.querySelector(".account__rewards");
    expect(rewards?.textContent).toContain("Fafnir");
    expect(rewards?.textContent).toContain("Titan ×2");
    expect(rewards?.textContent).toContain("Cards owned");
  });

  it("wires the sign-out button to the callback", () => {
    const onSignOut = vi.fn();
    const el = renderAccount(info, cards, onSignOut);
    el.querySelector<HTMLButtonElement>(".account__signout")!.click();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("handles a user with no faction chosen yet", () => {
    const el = renderAccount(
      { email: "a@b.co", faction: null, isRemote: false },
      cards,
      () => {},
    );
    expect(el.textContent).toContain("Not chosen yet");
  });
});

describe("mountAccount", () => {
  it("renders the signed-out prompt when there is no session", async () => {
    const auth = createLocalAuth(memoryStore());
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    expect(container.querySelector(".account--signed-out")).not.toBeNull();
  });

  it("renders the account for a signed-in demo user with a faction", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );

    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });

    expect(container.textContent).toContain("player@example.com");
    expect(container.textContent).toContain("Dwarf Starter Deck");
  });

  it("signs out and calls onSignOut", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    const onSignOut = vi.fn();

    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut });
    container.querySelector<HTMLButtonElement>(".account__signout")!.click();

    // Let the async signOut handler settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(await auth.getSession()).toBeNull();
  });
});

describe("mountAccount match stats", () => {
  /** Flushes the async showAccount/getMatchHistory microtask chain. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  async function signedInAccount(): Promise<{ container: HTMLElement }> {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    return { container };
  }

  it("shows a stats panel starting at zero matches", async () => {
    const { container } = await signedInAccount();
    const stats = container.querySelector(".account__stats");
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toContain("Total matches");
    expect(stats?.textContent).toContain("Win rate");
    // The next reward milestone is shown; with zero wins the first is win 5.
    expect(stats?.textContent).toContain("Next reward");
    expect(stats?.textContent).toContain("Win 5");
    expect(stats?.textContent?.toLowerCase()).toContain("no matches yet");
  });

  it("records a played match and reflects it in the stats after returning", async () => {
    const { container } = await signedInAccount();

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    await flush();

    const stats = container.querySelector(".account__stats");
    expect(stats?.textContent).not.toContain("no matches yet");
    // One match recorded; a recent-match row is now listed.
    expect(container.querySelectorAll(".account__recent-row")).toHaveLength(1);
  });

  it("shows an empty reward inventory before any rewards are earned", async () => {
    const { container } = await signedInAccount();
    expect(container.querySelector(".account__rewards")?.textContent?.toLowerCase())
      .toContain("no reward cards yet");
  });

  /** Reads a stat field's value (the <dd>) by its label text. */
  function statValue(container: HTMLElement, label: string): string | null {
    const fields = container.querySelectorAll(".account__stats .account__field");
    for (const f of fields) {
      if (f.querySelector(".account__label")?.textContent === label) {
        return f.querySelector(".account__value")?.textContent ?? null;
      }
    }
    return null;
  }

  it("counts wins over the FULL history, not just the recent 50", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const base: MatchHistoryInsert = {
      user_id: "local-demo",
      player_faction: "Dwarf",
      opponent_faction: "Sonic",
      winner: "Dwarf",
      result: "win",
      turns: 10,
      lives_left_player: 3,
      lives_left_opponent: 0,
      warriors_summoned_player: 4,
      warriors_summoned_opponent: 4,
      direct_attacks_player: 3,
      direct_attacks_opponent: 0,
    };
    const session: AuthSession = { userId: "local-demo", email: "player@example.com" };
    // 60 lifetime matches (> the 50-row recent window): 40 wins, 20 losses. If
    // stats were computed from the capped window the win count would be wrong.
    for (let i = 0; i < 40; i++) await auth.saveMatch(session, base);
    for (let i = 0; i < 20; i++)
      await auth.saveMatch(session, { ...base, result: "loss", winner: "Sonic" });

    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });

    expect(statValue(container, "Total matches")).toBe("60");
    expect(statValue(container, "Wins")).toBe("40");
    expect(statValue(container, "Losses")).toBe("20");
    // Recent list is still capped at 5, while the win counter spans everything —
    // both read the same saved history.
    expect(container.querySelectorAll(".account__recent-row")).toHaveLength(5);
  });

  it("warns (without crashing) when a completed match fails to save", async () => {
    const store = memoryStore();
    const base = createLocalAuth(store);
    await base.signUp("player@example.com", "pw");
    await base.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    // Same backend, but saving a match always fails (e.g. Supabase insert error).
    const auth: Auth = {
      ...base,
      saveMatch: async () => {
        throw new Error("insert failed");
      },
    };

    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    // The result screen still renders, with a clear, non-crashing warning.
    expect(container.querySelector(".match-result")).not.toBeNull();
    const warning = container.querySelector(".match-result__save-warning");
    expect(warning).not.toBeNull();
    expect(warning?.textContent?.toLowerCase()).toContain("couldn't save");
  });
});
