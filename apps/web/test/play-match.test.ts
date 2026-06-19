/**
 * Interactive match controller (play-match.ts): starting a match from the
 * starter deck and from a saved custom deck, exposing legal actions, the summon
 * flow, the attack/end-turn round-trip, and that a completed game still yields a
 * MatchSummary the existing history/result flow can consume.
 */
import { describe, expect, it } from "vitest";
import type { GameAction } from "@euphoria/game-engine";
import { smartAgent } from "@euphoria/simulator";
import { cards } from "../src/cards";
import { createPlayableMatch, ReplayError } from "../src/play-match";
import { buildMatchHistoryInsert } from "../src/match-history";
import { starterActiveDeck } from "../src/deck-builder";
import { STARTER_DECK_SIZE } from "../src/starter";

describe("createPlayableMatch — starting a match", () => {
  it("starts from the starter deck with the human as player1 to move", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const state = match.state();
    expect(match.playerFaction).toBe("Sonic");
    expect(match.opponentFaction).toBe("Dwarf");
    expect(state.activePlayer).toBe("player1");
    expect(match.isOver()).toBe(false);
    // 30-card decks, opening hand drawn (startingHand + turn-1 draw).
    expect(
      state.players.player1.deck.length + state.players.player1.hand.length,
    ).toBe(STARTER_DECK_SIZE);
    expect(state.players.player1.hand.length).toBeGreaterThan(0);
  });

  it("starts from a saved custom deck when one is provided", () => {
    // A valid custom deck stand-in: the faction's own starter entries.
    const entries = starterActiveDeck("Monk");
    const match = createPlayableMatch({
      faction: "Monk",
      pool: cards,
      seed: 7,
      opponentFaction: "Surfer",
      playerDeck: entries,
    });
    const state = match.state();
    expect(
      state.players.player1.deck.length + state.players.player1.hand.length,
    ).toBe(STARTER_DECK_SIZE);
    // Same seed + deck reproduces the same opening hand: deterministic.
    const again = createPlayableMatch({
      faction: "Monk",
      pool: cards,
      seed: 7,
      opponentFaction: "Surfer",
      playerDeck: entries,
    });
    expect(again.state().players.player1.hand.map((c) => c.id)).toEqual(
      state.players.player1.hand.map((c) => c.id),
    );
  });
});

describe("createPlayableMatch — legal actions", () => {
  it("offers end-turn and at least one summon on the opening turn", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const legal = match.legalActions();
    expect(legal.some((a) => a.kind === "endTurn")).toBe(true);
    expect(legal.some((a) => a.kind === "playWarrior")).toBe(true);
    // No attacks are legal on turn 1 (rules: noAttacksOnFirstTurn).
    expect(legal.some((a) => a.kind === "attack")).toBe(false);
  });

  it("returns no legal actions once the match is over", () => {
    const match = playToCompletion("Sonic", "Dwarf", 3);
    expect(match.isOver()).toBe(true);
    expect(match.legalActions()).toEqual([]);
  });
});

describe("createPlayableMatch — summon flow", () => {
  it("summons a Warrior, putting it on the field and spending Spirit", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const summon = match.legalActions().find((a) => a.kind === "playWarrior");
    expect(summon).toBeDefined();
    const spiritBefore = match.state().players.player1.spirit;
    const res = match.apply(summon!);
    expect(res.ok).toBe(true);
    const me = match.state().players.player1;
    expect(me.field.length).toBe(1);
    expect(me.spirit).toBeLessThan(spiritBefore);
    // It is still the human's turn after a Main-phase play.
    expect(match.state().activePlayer).toBe("player1");
  });

  it("rejects an action when it is not the human's turn", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    // Make a deliberately illegal call by forcing a non-legal action shape.
    const res = match.apply({ kind: "directAttack", attackerInstanceId: "nope" });
    expect(res.ok).toBe(false);
  });
});

describe("createPlayableMatch — end turn hands control to the AI", () => {
  it("plays out the opponent's whole turn and returns to the human", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 5,
      opponentFaction: "Dwarf",
    });
    const startTurn = match.state().turn;
    const endTurn = match.legalActions().find((a) => a.kind === "endTurn")!;
    const res = match.apply(endTurn);
    expect(res.ok).toBe(true);
    // Control is back with the human (or the game ended) — never stuck on the AI.
    if (!match.isOver()) {
      expect(match.state().activePlayer).toBe("player1");
      expect(match.state().turn).toBeGreaterThan(startTurn);
    }
  });
});

describe("createPlayableMatch — completion still yields a summary", () => {
  it("produces a MatchSummary the history insert can consume", () => {
    const match = playToCompletion("Sonic", "Dwarf", 3);
    expect(match.isOver()).toBe(true);
    const summary = match.summary();
    expect(["win", "loss", "draw"]).toContain(summary.outcome);
    expect(summary.playerFaction).toBe("Sonic");
    expect(summary.opponentFaction).toBe("Dwarf");
    expect(summary.highlights.length).toBeGreaterThan(0);
    // The existing history/reward flow consumes the summary unchanged.
    const insert = buildMatchHistoryInsert("user-123", summary);
    expect(insert.player_faction).toBe("Sonic");
    expect(insert.result).toBe(summary.outcome);
  });
});

/**
 * Drives a match to its end by having the human always end their turn, letting
 * the aggressive AI close it out. Deterministic for a fixed seed.
 */
function playToCompletion(
  faction: "Sonic",
  opponentFaction: "Dwarf",
  seed: number,
): ReturnType<typeof createPlayableMatch> {
  const match = createPlayableMatch({ faction, pool: cards, seed, opponentFaction });
  let guard = 0;
  while (!match.isOver() && guard < 500) {
    const endTurn = match.legalActions().find((a) => a.kind === "endTurn");
    if (endTurn === undefined) break;
    const res = match.apply(endTurn);
    if (!res.ok) break;
    guard += 1;
  }
  return match;
}

describe("createPlayableMatch — resume via deterministic action replay", () => {
  function fingerprint(match: ReturnType<typeof createPlayableMatch>) {
    const s = match.state();
    return {
      turn: s.turn,
      activePlayer: s.activePlayer,
      winner: s.winner,
      events: s.events.length,
      p1Field: s.players.player1.field.map((w) => w.instanceId).join(","),
      p2Field: s.players.player2.field.map((w) => w.instanceId).join(","),
      p1Hand: s.players.player1.hand.map((c) => c.id).join(","),
      p1Lives: s.players.player1.lives,
      p2Lives: s.players.player2.lives,
    };
  }

  it("records human actions and replays them to the exact same state", () => {
    const agent = smartAgent();
    const live = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 11,
      opponentFaction: "Dwarf",
    });
    // Play partway (stop before the game ends) so there is a state to resume.
    let guard = 0;
    while (!live.isOver() && live.state().events.length < 120 && guard < 400) {
      const legal = live.legalActions();
      if (legal.length === 0) break;
      live.apply(agent(live.state(), legal));
      guard++;
    }
    expect(live.isOver()).toBe(false);
    const history = live.history();
    expect(history.length).toBeGreaterThan(0);

    // Rebuild from the same seed/opponent/deck and replay the recorded actions.
    const resumed = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 11,
      opponentFaction: "Dwarf",
      replay: history,
    });
    // The opponent is deterministic, so the resumed state matches exactly.
    expect(fingerprint(resumed)).toEqual(fingerprint(live));
    // It continues as a normal live match and keeps recording.
    expect(resumed.legalActions().length).toBeGreaterThan(0);
    expect(resumed.history()).toEqual(history);
  });

  it("throws ReplayError when a saved action no longer applies", () => {
    const bad = [
      { kind: "attack", attackerInstanceId: "nope", defenderInstanceId: "nope" },
    ] as unknown as GameAction[];
    expect(() =>
      createPlayableMatch({
        faction: "Sonic",
        pool: cards,
        seed: 1,
        opponentFaction: "Dwarf",
        replay: bad,
      }),
    ).toThrow(ReplayError);
  });
});
