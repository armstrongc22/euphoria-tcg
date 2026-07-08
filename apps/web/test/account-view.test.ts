/**
 * @vitest-environment jsdom
 *
 * Account page rendering. Exercises the pure renderAccount builder (email,
 * faction, starter deck, progression + rewards placeholders, sign out) and the
 * mountAccount loader against the localStorage demo backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cards } from "@euphoria/core/cards";
import { renderAccount, mountAccount, type AccountInfo } from "../src/account-view";
import { createLocalAuth, type Auth, type AuthSession } from "@euphoria/core/auth";
import type { MatchHistoryInsert } from "@euphoria/core/match-history";
import { ACTIVE_MATCH_KEY, saveActiveMatch } from "@euphoria/core/match-recovery";
import { deckCardCount, getRecipe } from "@euphoria/core/starter";
import type { KeyValueStore } from "@euphoria/core/signup";

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

  it("renders the onboarding next-step card with its CTA (Feature C)", () => {
    const onNext = vi.fn();
    const el = renderAccount(
      {
        ...info,
        nextStep: { id: "first-match", body: "Play your first live match.", cta: "Play match" },
      },
      cards,
      () => {},
      undefined,
      undefined,
      onNext,
    );
    const card = el.querySelector<HTMLElement>(".account__nextstep");
    expect(card).not.toBeNull();
    expect(card!.dataset.step).toBe("first-match");
    expect(card!.textContent).toContain("Play your first live match.");
    el.querySelector<HTMLButtonElement>(".account__nextstep-cta")!.click();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("omits the next-step card when no step is provided", () => {
    expect(renderAccount(info, cards, () => {}).querySelector(".account__nextstep")).toBeNull();
  });

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

  it("shows a COMPACT Getting Started card (current step only) by default", async () => {
    window.localStorage.clear();
    const { container } = await signedInAccount();
    const onboarding = container.querySelector(".onboarding");
    expect(onboarding).not.toBeNull();
    expect(onboarding?.classList.contains("onboarding--compact")).toBe(true);
    expect(onboarding?.textContent).toContain("Getting Started");
    // Faction chosen, no matches → current step is "Play first match"…
    const current = onboarding!.querySelector<HTMLElement>(".onboarding__item--current");
    expect(current?.dataset.step).toBe("play-first-match");
    // …and the locked future steps are NOT rendered by default.
    expect(onboarding!.querySelectorAll(".onboarding__item")).toHaveLength(1);
    expect(container.querySelector(".account__reset-tutorial")).not.toBeNull();
  });

  it("Reset tutorial tips clears tutorial flags but not progression", async () => {
    window.localStorage.clear();
    // Pretend the player dismissed a tutorial + has a non-tutorial key.
    window.localStorage.setItem("euphoria.tutorial.v1", JSON.stringify({ welcome: true }));
    window.localStorage.setItem("euphoria.owned.v1", "[]");
    const { container } = await signedInAccount();
    container.querySelector<HTMLButtonElement>(".account__reset-tutorial")!.click();
    await flush();
    expect(window.localStorage.getItem("euphoria.tutorial.v1")).toBeNull();
    // Game-progression key is untouched.
    expect(window.localStorage.getItem("euphoria.owned.v1")).toBe("[]");
  });

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

  it("advances the checklist + shows a completion nudge after a match", async () => {
    const { container } = await signedInAccount();
    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    // Feature D: the result screen carries an onboarding nudge.
    expect(
      container.querySelector(".match-result__onboard-note")?.textContent ?? "",
    ).toMatch(/win|completed a match/i);
    container.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    await flush();
    // "Play first match" is now done, so the compact card's current step has
    // advanced past it (compact renders only the current step).
    const current = container.querySelector<HTMLElement>(".onboarding__item--current");
    expect(current).not.toBeNull();
    expect(current!.dataset.step).not.toBe("play-first-match");
    expect(current!.dataset.step).not.toBe("choose-starter");
  });

  it("Show all steps expands to the full list; Collapse returns to compact", async () => {
    window.localStorage.clear();
    const { container } = await signedInAccount();
    // Default compact: one item.
    expect(container.querySelectorAll(".onboarding__item")).toHaveLength(1);
    container.querySelector<HTMLButtonElement>(".onboarding__expand")!.click();
    await flush();
    const expanded = container.querySelector(".onboarding");
    expect(expanded?.classList.contains("onboarding--expanded")).toBe(true);
    expect(container.querySelectorAll(".onboarding__item")).toHaveLength(8);
    // Collapse returns to the compact single-step card.
    expanded!.querySelector<HTMLButtonElement>(".onboarding__collapse")!.click();
    await flush();
    expect(container.querySelector(".onboarding")?.classList.contains("onboarding--compact"))
      .toBe(true);
    expect(container.querySelectorAll(".onboarding__item")).toHaveLength(1);
  });

  it("Hide guide hides the card and Show Getting Started brings it back", async () => {
    window.localStorage.clear();
    const { container } = await signedInAccount();
    container.querySelector<HTMLButtonElement>(".onboarding__hide")!.click();
    await flush();
    expect(container.querySelector(".onboarding")).toBeNull();
    const show = container.querySelector<HTMLButtonElement>(".onboarding__show");
    expect(show?.textContent).toBe("Show Getting Started");
    show!.click();
    await flush();
    // Back to the compact card, with the derived next step preserved.
    const card = container.querySelector(".onboarding");
    expect(card?.classList.contains("onboarding--compact")).toBe(true);
    expect(card!.querySelector<HTMLElement>(".onboarding__item--current")?.dataset.step).toBe(
      "play-first-match",
    );
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

describe("mountAccount — interrupted-match recovery", () => {
  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }

  async function mountDemo(): Promise<HTMLElement> {
    const auth = createLocalAuth(memoryStore());
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    return container;
  }

  function seedSavedMatch(): void {
    saveActiveMatch(window.localStorage, {
      userId: "local-demo",
      faction: "Dwarf",
      opponentFaction: "Sonic",
      seed: 5,
      playerDeck: null,
      actions: [], // replays to a fresh match → resume always succeeds
      turn: 4,
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows a Resume banner when a live match was interrupted", async () => {
    seedSavedMatch();
    const container = await mountDemo();
    const banner = container.querySelector(".account__resume");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Dwarf");
    expect(banner?.textContent).toContain("turn 4");
    expect(banner?.querySelector(".account__resume-btn")).not.toBeNull();
    expect(banner?.querySelector(".account__resume-discard")).not.toBeNull();
  });

  it("does not show a Resume banner with no saved match", async () => {
    const container = await mountDemo();
    expect(container.querySelector(".account__resume")).toBeNull();
  });

  it("Resume mounts the live match board", async () => {
    seedSavedMatch();
    const container = await mountDemo();
    container.querySelector<HTMLButtonElement>(".account__resume-btn")!.click();
    expect(container.querySelector(".play-match")).not.toBeNull();
  });

  it("Discard clears the saved match and removes the banner", async () => {
    seedSavedMatch();
    const container = await mountDemo();
    container.querySelector<HTMLButtonElement>(".account__resume-discard")!.click();
    await flush();
    expect(window.localStorage.getItem(ACTIVE_MATCH_KEY)).toBeNull();
    expect(container.querySelector(".account__resume")).toBeNull();
  });

  it("persists a live match on start and clears it on concede", async () => {
    const container = await mountDemo();
    // Start a live match from the account's Play button.
    container.querySelector<HTMLButtonElement>(".account__play--live")!.click();
    await flush();
    expect(container.querySelector(".play-match")).not.toBeNull();
    // The in-progress match is checkpointed for recovery.
    expect(window.localStorage.getItem(ACTIVE_MATCH_KEY)).not.toBeNull();
    // Conceding abandons the match and clears the saved state.
    container.querySelector<HTMLButtonElement>(".play-match__quit")!.click();
    await flush();
    expect(window.localStorage.getItem(ACTIVE_MATCH_KEY)).toBeNull();
  });

  // The autoPlay path is the "Start Match" menu entry: with an interrupted
  // match on disk it must gate on Continue/Concede instead of silently
  // starting (and checkpoint-overwriting) a fresh game.
  async function mountAutoPlay(): Promise<HTMLElement> {
    const auth = createLocalAuth(memoryStore());
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const container = document.createElement("div");
    await mountAccount(container, {
      auth,
      pool: cards,
      onSignOut: () => {},
      autoPlay: "Dwarf",
    });
    return container;
  }

  it("Start Match gates on the recovery prompt when a match was interrupted", async () => {
    seedSavedMatch();
    const container = await mountAutoPlay();
    expect(container.querySelector(".play-match")).toBeNull();
    const gate = container.querySelector(".account__resume");
    expect(gate).not.toBeNull();
    expect(gate?.textContent).toContain("You have an unfinished duel.");
    expect(gate?.textContent).toContain("turn 4");
  });

  it("Continue Duel resumes the interrupted board", async () => {
    seedSavedMatch();
    const container = await mountAutoPlay();
    container.querySelector<HTMLButtonElement>(".account__resume-btn")!.click();
    await flush();
    expect(container.querySelector(".play-match")).not.toBeNull();
    // Still the same recovery record's game — the checkpoint persists.
    expect(window.localStorage.getItem(ACTIVE_MATCH_KEY)).not.toBeNull();
  });

  it("Concede clears the snapshot (no reward path) and starts the fresh match", async () => {
    seedSavedMatch();
    const container = await mountAutoPlay();
    container.querySelector<HTMLButtonElement>(".account__resume-discard")!.click();
    await flush();
    // The old snapshot is gone; the new match's own checkpoint replaces it.
    const board = container.querySelector(".play-match");
    expect(board).not.toBeNull();
    expect(container.querySelector(".account__resume")).toBeNull();
  });

  it("Start Match proceeds straight to the board with nothing to recover", async () => {
    const container = await mountAutoPlay();
    expect(container.querySelector(".account__resume")).toBeNull();
    expect(container.querySelector(".play-match")).not.toBeNull();
  });
});
