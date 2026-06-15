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
import { createLocalAuth } from "../src/auth";
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

  it("shows win-based reward progress when provided", () => {
    const el = renderAccount(
      {
        ...info,
        rewardProgress: { wins: 7, nextReward: 10, nextEnhanced: 15 },
      },
      cards,
      () => {},
    );
    const progress = el.querySelector(".account__reward-progress");
    expect(progress?.textContent).toContain("Wins");
    expect(progress?.textContent).toContain("7");
    expect(progress?.textContent).toContain("10 wins");
    expect(progress?.textContent).toContain("15 wins");
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
    expect(stats?.textContent?.toLowerCase()).toContain("no matches yet");
  });

  it("records a played match and reflects it in the stats after returning", async () => {
    const { container } = await signedInAccount();

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
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
});
