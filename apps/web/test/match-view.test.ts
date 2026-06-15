/**
 * @vitest-environment jsdom
 *
 * Match UI: the result card (renderMatchResult) and the account-page flow that
 * launches a match. Confirms the "Play test match" button appears for a
 * signed-in user with a faction (including the localStorage demo fallback),
 * that clicking it shows a result with the reward placeholder, and that Play
 * again / Back to account work.
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { mountAccount } from "../src/account-view";
import { createLocalAuth } from "../src/auth";
import { renderMatchResult } from "../src/match-view";
import { runTestMatch } from "../src/match";
import type { KeyValueStore } from "../src/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

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
  async function mountedDemoAccount(): Promise<HTMLElement> {
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

  it("offers a Play test match button for a signed-in demo user", async () => {
    const container = await mountedDemoAccount();
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("runs a match and shows the result plus reward options, then returns", async () => {
    const container = await mountedDemoAccount();

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
    // The reward chooser is appended after the result with three options.
    const options = container.querySelectorAll(".reward-choice__option");
    expect(options).toHaveLength(3);

    container.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    // Back to account reloads match history, so let that async render settle.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(container.querySelector(".match-result")).toBeNull();
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("claims a reward card and shows it in the account inventory", async () => {
    const container = await mountedDemoAccount();

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    const firstOption =
      container.querySelector<HTMLButtonElement>(".reward-choice__option")!;
    const chosenName =
      firstOption.querySelector(".reward-choice__name")?.textContent ?? "";
    firstOption.click();

    // saveReward + showAccount are async; let the microtask chain settle.
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(container.querySelector(".match-result")).toBeNull();
    const rewards = container.querySelector(".account__rewards");
    expect(rewards?.textContent).toContain(chosenName);
    expect(rewards?.querySelectorAll(".account__owned-row")).toHaveLength(1);
  });

  it("Play again keeps showing a result", async () => {
    const container = await mountedDemoAccount();
    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    container.querySelector<HTMLButtonElement>(".match-result__again")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
  });
});
