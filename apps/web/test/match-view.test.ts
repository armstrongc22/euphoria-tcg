/**
 * @vitest-environment jsdom
 *
 * Match UI: the result card (renderMatchResult) and the account-page flow that
 * launches a match. Confirms the "Play test match" button appears for a
 * signed-in user with a faction (including the localStorage demo fallback),
 * that clicking it shows a result with the reward placeholder, and that Play
 * again / Back to account work.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cards } from "@euphoria/core/cards";
import { mountAccount } from "../src/account-view";
import { createLocalAuth } from "../src/auth";
import { appendLocalMatch } from "../src/match-history";
import { renderMatchResult } from "../src/match-view";
import { runTestMatch } from "@euphoria/core/match";
import type { KeyValueStore } from "@euphoria/core/signup";
import type { StarterFaction } from "@euphoria/core/starter";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Flushes the async showResult/showAccount microtask chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Records `n` prior wins for the demo user, so the next win lands as #(n+1). */
function seedWins(store: KeyValueStore, faction: StarterFaction, n: number): void {
  for (let i = 0; i < n; i++) {
    appendLocalMatch(store, {
      user_id: "local-demo",
      player_faction: faction,
      opponent_faction: "Sonic",
      winner: faction,
      result: "win",
      turns: 7,
      lives_left_player: 1,
      lives_left_opponent: 0,
      warriors_summoned_player: 3,
      warriors_summoned_opponent: 2,
      direct_attacks_player: 3,
      direct_attacks_opponent: 0,
    });
  }
}

/** Finds the first seed for which `faction` wins, so a played match is a win. */
function winningSeed(faction: StarterFaction): number {
  for (let seed = 1; seed < 500; seed++) {
    if (runTestMatch({ faction, pool: cards, seed }).playerWon) return seed;
  }
  throw new Error(`No winning seed found for ${faction}`);
}

/** Forces runTestMatch's `Math.random()` seed to land on `seed`. */
function forceSeed(seed: number): void {
  vi.spyOn(Math, "random").mockReturnValue((seed + 0.5) / 0x7fffffff);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderMatchResult", () => {
  const summary = runTestMatch({ faction: "Sonic", pool: cards, seed: 1 });

  it("shows both factions, the winner, and turns (no reward panel here)", () => {
    const el = renderMatchResult(summary, { onPlayAgain: () => {}, onBack: () => {} });
    const text = el.textContent ?? "";
    expect(text).toContain("Sonic");
    expect(text).toContain(summary.opponentFaction);
    expect(text).toContain(summary.winnerLabel);
    expect(text).toContain(String(summary.turns));
    // The reward chooser is a separate panel appended by the account flow.
    expect(el.querySelector(".reward-choice")).toBeNull();
  });

  it("wires Play again and Back to account", () => {
    const onPlayAgain = vi.fn();
    const onBack = vi.fn();
    const el = renderMatchResult(summary, { onPlayAgain, onBack });
    el.querySelector<HTMLButtonElement>(".match-result__again")!.click();
    el.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("account page test-match flow (local fallback)", () => {
  async function mountedDemoAccount(
    store: KeyValueStore = memoryStore(),
  ): Promise<HTMLElement> {
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    return container;
  }

  it("offers a Play test match button for a signed-in demo user", async () => {
    const container = await mountedDemoAccount();
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("shows the result but NO reward chooser on a non-milestone match", async () => {
    const container = await mountedDemoAccount();

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    expect(container.querySelector(".match-result")).not.toBeNull();
    // The very first match can never be a 5th win, so no reward is offered.
    expect(container.querySelector(".reward-choice")).toBeNull();

    container.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    await flush();
    expect(container.querySelector(".match-result")).toBeNull();
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("offers a reward chooser when a win lands on a milestone (5th win)", async () => {
    const store = memoryStore();
    seedWins(store, "Dwarf", 4); // four prior wins → next win is the 5th
    forceSeed(winningSeed("Dwarf")); // make the played match a win
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    expect(container.querySelector(".match-result")).not.toBeNull();
    const options = container.querySelectorAll(".reward-choice__option");
    expect(options).toHaveLength(3);
  });

  it("claims a milestone reward card and shows it in the account inventory", async () => {
    const store = memoryStore();
    seedWins(store, "Dwarf", 4);
    forceSeed(winningSeed("Dwarf"));
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    const firstOption =
      container.querySelector<HTMLButtonElement>(".reward-choice__option")!;
    const chosenName =
      firstOption.querySelector(".reward-choice__name")?.textContent ?? "";
    firstOption.click();
    await flush();

    expect(container.querySelector(".match-result")).toBeNull();
    const rewards = container.querySelector(".account__rewards");
    expect(rewards?.textContent).toContain(chosenName);
    expect(rewards?.querySelectorAll(".account__owned-row")).toHaveLength(1);

    // The reward_events row persisted the milestone (5) and tier (1).
    const raw = store.getItem("euphoria.rewardEvents.v1");
    expect(raw).not.toBeNull();
    const events = JSON.parse(raw!);
    expect(events).toHaveLength(1);
    expect(events[0].milestone).toBe(5);
    expect(events[0].tier).toBe(1);
  });

  it("Play again keeps showing a result", async () => {
    const container = await mountedDemoAccount();
    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".match-result__again")!.click();
    await flush();
    expect(container.querySelector(".match-result")).not.toBeNull();
  });
});

describe("reward modal (Feature A)", () => {
  async function mountedDemoAccount(store: KeyValueStore): Promise<HTMLElement> {
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "pw");
    await auth.saveFaction(
      { userId: "local-demo", email: "player@example.com" },
      "Dwarf",
    );
    const container = document.createElement("div");
    await mountAccount(container, { auth, pool: cards, onSignOut: () => {} });
    return container;
  }

  /** First seed for which `faction` loses, so a played match is a loss. */
  function losingSeed(faction: StarterFaction): number {
    for (let seed = 1; seed < 500; seed++) {
      if (!runTestMatch({ faction, pool: cards, seed }).playerWon) return seed;
    }
    throw new Error(`No losing seed found for ${faction}`);
  }

  it("pops the reward modal immediately on a milestone win", async () => {
    const store = memoryStore();
    seedWins(store, "Dwarf", 4);
    forceSeed(winningSeed("Dwarf"));
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    const modal = container.querySelector(".reward-modal");
    expect(modal).not.toBeNull();
    expect(modal!.querySelectorAll(".reward-choice__option")).toHaveLength(3);
    // No "next reward" note when a reward IS offered.
    expect(container.querySelector(".match-result__reward-note")).toBeNull();
  });

  it("shows no modal and a 'next reward' note on a non-milestone win", async () => {
    const store = memoryStore();
    forceSeed(winningSeed("Dwarf")); // first win → win #1, not a milestone
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    expect(container.querySelector(".reward-modal")).toBeNull();
    const note = container.querySelector(".match-result__reward-note");
    expect(note?.textContent).toBe("Next reward at 5 wins.");
  });

  it("shows no modal on a loss", async () => {
    const store = memoryStore();
    seedWins(store, "Dwarf", 4); // 4 wins; a loss keeps it at 4
    forceSeed(losingSeed("Dwarf"));
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();

    expect(container.querySelector(".reward-modal")).toBeNull();
    expect(container.querySelector(".match-result__reward-note")?.textContent).toBe(
      "Next reward at 5 wins.",
    );
  });

  it("claiming from the modal saves the reward and dismisses the overlay", async () => {
    const store = memoryStore();
    seedWins(store, "Dwarf", 4);
    forceSeed(winningSeed("Dwarf"));
    const container = await mountedDemoAccount(store);

    container.querySelector<HTMLButtonElement>(".account__play--sim")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".reward-modal .reward-choice__option")!.click();
    await flush();

    expect(container.querySelector(".reward-modal")).toBeNull();
    expect(JSON.parse(store.getItem("euphoria.rewardEvents.v1")!)).toHaveLength(1);
    expect(container.querySelector(".account__rewards")?.querySelectorAll(".account__owned-row")).toHaveLength(1);
  });
});
