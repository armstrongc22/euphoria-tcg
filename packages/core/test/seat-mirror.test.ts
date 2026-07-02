/**
 * Seat mirroring (seat-mirror.ts): the deep player1/player2 swap over engine
 * data, its involution property on a real game state, and the PlayableMatch
 * mirror wrapper (joiner-POV rendering without touching the canonical game).
 */
import { describe, expect, it } from "vitest";
import { cards } from "@euphoria/core/cards";
import { createPlayableMatch } from "../src/play-match";
import { mirrorPlayableMatch, swapSeats } from "../src/seat-mirror";

describe("swapSeats", () => {
  it("swaps exact seat string values and record keys, deeply", () => {
    const input = {
      activePlayer: "player1",
      winner: null,
      players: {
        player1: { lives: 3, hand: ["a"] },
        player2: { lives: 2, hand: ["b"] },
      },
      events: [
        { type: "directAttack", player: "player2", livesRemaining: 2 },
      ],
    };
    const out = swapSeats(input);
    expect(out.activePlayer).toBe("player2");
    expect(out.players.player1).toEqual({ lives: 2, hand: ["b"] });
    expect(out.players.player2).toEqual({ lives: 3, hand: ["a"] });
    expect(out.events[0]).toEqual({
      type: "directAttack",
      player: "player1",
      livesRemaining: 2,
    });
    // The input is never mutated.
    expect(input.activePlayer).toBe("player1");
  });

  it("leaves non-seat strings (ids, names, substrings) untouched", () => {
    const input = {
      instanceId: "warrior-1",
      slug: "player1-fanclub", // substring, not an exact seat literal
      note: "player1 vs player2 recap",
      count: 7,
      flag: true,
      missing: null,
    };
    expect(swapSeats(input)).toEqual(input);
  });

  it("is an involution: swapping twice restores the original", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 11,
      opponentFaction: "Dwarf",
    });
    const state = match.state();
    expect(swapSeats(swapSeats(state))).toEqual(state);
  });

  it("mirrors a real engine state coherently", () => {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 11,
      opponentFaction: "Dwarf",
    });
    const state = match.state();
    const mirrored = swapSeats(state);
    expect(mirrored.activePlayer).toBe("player2"); // canonical player1 to move
    expect(mirrored.players.player2.hand.map((c) => c.slug)).toEqual(
      state.players.player1.hand.map((c) => c.slug),
    );
    expect(mirrored.players.player1.deck.length).toBe(
      state.players.player2.deck.length,
    );
    // Card data inside the state is unchanged by the swap.
    expect(mirrored.players.player2.hand[0]).toEqual(state.players.player1.hand[0]);
  });
});

describe("mirrorPlayableMatch", () => {
  it("mirrors state/legalActions out and un-mirrors actions in", () => {
    const inner = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 3,
      opponentFaction: "Dwarf",
    });
    const mirrored = mirrorPlayableMatch(inner);

    // Viewer-relative fields pass through.
    expect(mirrored.playerFaction).toBe(inner.playerFaction);
    expect(mirrored.seed).toBe(inner.seed);

    // The canonical player1 is to move; mirrored, that seat reads player2.
    expect(inner.state().activePlayer).toBe("player1");
    expect(mirrored.state().activePlayer).toBe("player2");

    // Same actions offered (they carry ids, not seats, so they round-trip).
    const innerLegal = inner.legalActions();
    const mirroredLegal = mirrored.legalActions();
    expect(mirroredLegal).toEqual(swapSeats(innerLegal));
    expect(mirroredLegal.length).toBeGreaterThan(0);

    // Applying through the mirror drives the same canonical game.
    const end = mirroredLegal.find((a) => a.kind === "endTurn")!;
    const res = mirrored.apply(end);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The first frame is the human's endTurn snapshot: canonically control
      // passed to player2, so the mirrored frame reads player1.
      expect(res.frames[0]!.actor).toBe("player");
      expect(res.frames[0]!.state.activePlayer).toBe("player1");
    }
    expect(inner.history()).toHaveLength(1);
  });
});
