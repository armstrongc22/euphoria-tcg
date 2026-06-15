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

  it("shows both factions, the winner, turns, and the reward placeholder", () => {
    const el = renderMatchResult(summary, { onPlayAgain: () => {}, onBack: () => {} });
    const text = el.textContent ?? "";
    expect(text).toContain("Sonic");
    expect(text).toContain(summary.opponentFaction);
    expect(text).toContain(summary.winnerLabel);
    expect(text).toContain(String(summary.turns));
    expect(text.toLowerCase()).toContain("reward cards coming soon");
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

  it("runs a match and shows the result, then returns to the account", async () => {
    const container = await mountedDemoAccount();

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
    expect(container.textContent?.toLowerCase()).toContain("reward cards coming soon");

    container.querySelector<HTMLButtonElement>(".match-result__back")!.click();
    expect(container.querySelector(".match-result")).toBeNull();
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("Play again keeps showing a result", async () => {
    const container = await mountedDemoAccount();
    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    container.querySelector<HTMLButtonElement>(".match-result__again")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
  });
});
