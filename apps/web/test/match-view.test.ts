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
import type { GameResult } from "@euphoria/simulator";
import { cards } from "../src/cards";
import { mountAccount } from "../src/account-view";
import { createLocalAuth, type Auth, type AuthSession } from "../src/auth";
import { renderMatchResult } from "../src/match-view";
import { runTestMatch, type MatchOutcome, type MatchSummary } from "../src/match";
import type { MatchHistoryInsert } from "../src/match-history";
import type { KeyValueStore } from "../src/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SESSION: AuthSession = { userId: "local-demo", email: "player@example.com" };

/** A controllable MatchSummary so the account flow's pacing can be tested. */
function fakeSummary(outcome: MatchOutcome, seed = 1): MatchSummary {
  const playerWon = outcome === "win";
  const result: GameResult = {
    winner: outcome === "draw" ? null : playerWon ? "player1" : "player2",
    reason: outcome === "draw" ? "maxTurns" : "win",
    turns: 12,
    actions: 50,
    events: 20,
    finalLives: { player1: playerWon ? 3 : 0, player2: playerWon ? 0 : 3 },
    winByDirectAttack: outcome !== "draw",
    effectFallbacks: 0,
    deckOuts: 0,
    summons: { player1: 4, player2: 4 },
    warriorsLost: { player1: 1, player2: 1 },
    directAttacks: { player1: playerWon ? 3 : 0, player2: playerWon ? 0 : 3 },
  };
  return {
    playerFaction: "Dwarf",
    opponentFaction: "Sonic",
    outcome,
    playerWon,
    winnerLabel: playerWon ? "You" : outcome === "draw" ? "Draw" : "Sonic",
    turns: 12,
    highlights: ["x"],
    result,
    seed,
  };
}

const WIN_INSERT: MatchHistoryInsert = {
  user_id: SESSION.userId,
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

/** Signs in a demo account, seeds `wins` prior wins, and returns auth + store. */
async function demoAuthWithWins(wins: number): Promise<Auth> {
  const auth = createLocalAuth(memoryStore());
  await auth.signUp("player@example.com", "pw");
  await auth.saveFaction(SESSION, "Dwarf");
  for (let i = 0; i < wins; i++) await auth.saveMatch(SESSION, WIN_INSERT);
  return auth;
}

/** Lets the async showAccount/save microtask chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
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

describe("account page test-match flow (local fallback, paced rewards)", () => {
  /** Mounts an account whose matches return the given outcome via injection. */
  async function mountWithOutcome(
    auth: Auth,
    outcome: MatchOutcome,
  ): Promise<HTMLElement> {
    const container = document.createElement("div");
    await mountAccount(container, {
      auth,
      pool: cards,
      onSignOut: () => {},
      runMatch: () => fakeSummary(outcome),
    });
    return container;
  }

  it("offers a Play test match button for a signed-in demo user", async () => {
    const container = await mountWithOutcome(await demoAuthWithWins(0), "win");
    expect(container.querySelector(".account__play")).not.toBeNull();
  });

  it("shows the next-reward note (no chooser) for a non-milestone win", async () => {
    const container = await mountWithOutcome(await demoAuthWithWins(0), "win");

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
    // 1 win total → no reward yet; a forward-looking note instead of a chooser.
    expect(container.querySelector(".reward-choice")).toBeNull();
    expect(container.querySelector(".match-result__reward-note")?.textContent)
      .toContain("Next reward at 5 wins.");
  });

  it("offers 3 basic options at a 5-win milestone, claimable into inventory", async () => {
    // 4 prior wins + this winning match = 5 → basic milestone.
    const container = await mountWithOutcome(await demoAuthWithWins(4), "win");

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    const chooser = container.querySelector(".reward-choice");
    expect(chooser).not.toBeNull();
    expect(chooser?.classList.contains("reward-choice--basic")).toBe(true);
    const firstOption =
      container.querySelector<HTMLButtonElement>(".reward-choice__option")!;
    const chosenName =
      firstOption.querySelector(".reward-choice__name")?.textContent ?? "";
    expect(container.querySelectorAll(".reward-choice__option")).toHaveLength(3);

    firstOption.click();
    await flush();

    expect(container.querySelector(".match-result")).toBeNull();
    const rewards = container.querySelector(".account__rewards");
    expect(rewards?.textContent).toContain(chosenName);
    expect(rewards?.querySelectorAll(".account__owned-row")).toHaveLength(1);
  });

  it("offers an enhanced reward at a 15-win milestone", async () => {
    const container = await mountWithOutcome(await demoAuthWithWins(14), "win");

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    const chooser = container.querySelector(".reward-choice");
    expect(chooser?.classList.contains("reward-choice--enhanced")).toBe(true);
    expect(chooser?.textContent?.toLowerCase()).toContain("enhanced reward");
  });

  it("grants no reward on a loss, even at a milestone win count", async () => {
    // 4 prior wins; a loss leaves the total at 4 → still below the milestone.
    const container = await mountWithOutcome(await demoAuthWithWins(4), "loss");

    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    expect(container.querySelector(".reward-choice")).toBeNull();
    expect(container.querySelector(".match-result__reward-note")).not.toBeNull();
  });

  it("does not offer the same milestone twice in one session", async () => {
    const container = await mountWithOutcome(await demoAuthWithWins(4), "win");

    // First win reaches milestone 5 → claim it.
    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    container.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    await flush();

    // Next win (total 6) is past the claimed milestone → note, no chooser.
    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    expect(container.querySelector(".reward-choice")).toBeNull();
    expect(container.querySelector(".match-result__reward-note")).not.toBeNull();
  });

  it("Play again keeps showing a result", async () => {
    const container = await mountWithOutcome(await demoAuthWithWins(0), "win");
    container.querySelector<HTMLButtonElement>(".account__play")!.click();
    container.querySelector<HTMLButtonElement>(".match-result__again")!.click();
    expect(container.querySelector(".match-result")).not.toBeNull();
  });
});
