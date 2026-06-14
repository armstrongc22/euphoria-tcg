/**
 * Trace tool tests: check the structured trace's shape and the formatter's
 * sections deterministically, without snapshotting the whole long text.
 */
import { loadCards, type Card } from "@euphoria/card-data";
import { beforeAll, describe, expect, it } from "vitest";
import { formatTrace, generateTrace, type TraceResult } from "../src/trace";

let pool: Card[];
let trace: TraceResult;
beforeAll(() => {
  pool = loadCards();
  trace = generateTrace({
    pool,
    player1Faction: "Monk",
    player2Faction: "Dwarf",
    seed: 123,
    maxTurns: 20,
  });
});

describe("generateTrace", () => {
  it("records the requested setup", () => {
    expect(trace.player1Faction).toBe("Monk");
    expect(trace.player2Faction).toBe("Dwarf");
    expect(trace.seed).toBe(123);
    expect(trace.deckSizes).toEqual({ player1: 30, player2: 30 });
  });

  it("recovers a 5-card opening hand for each player", () => {
    expect(trace.openingHands.player1).toHaveLength(5);
    expect(trace.openingHands.player2).toHaveLength(5);
    // Names, not ids — every entry resolves to a real card name.
    const names = new Set(pool.map((c) => c.name));
    for (const seat of ["player1", "player2"] as const) {
      for (const name of trace.openingHands[seat]) expect(names.has(name)).toBe(true);
    }
  });

  it("captures a setup step (action: null) followed by action steps", () => {
    expect(trace.steps.length).toBeGreaterThan(1);
    expect(trace.steps[0]!.action).toBeNull();
    expect(trace.steps.slice(1).every((s) => s.action !== null)).toBe(true);
  });

  it("accounts for every event exactly once across steps", () => {
    const counted = trace.steps.reduce((sum, s) => sum + s.events.length, 0);
    expect(counted).toBe(trace.totalEvents);
  });

  it("reaches a decisive result with a consistent winner/reason", () => {
    expect(trace.reason).toBe("win");
    expect(trace.winner === "player1" || trace.winner === "player2").toBe(true);
    expect(trace.turns).toBeLessThanOrEqual(trace.maxTurns);
    // A direct attack to 0 lives is the only win path today.
    const directKill = trace.steps
      .flatMap((s) => s.events)
      .some((e) => e.type === "directAttacked" && e.livesRemaining <= 0);
    expect(directKill).toBe(true);
  });

  it("contains the core action events (summon + attack)", () => {
    const types = new Set(trace.steps.flatMap((s) => s.events).map((e) => e.type));
    expect(types.has("warriorSummoned")).toBe(true);
    expect(types.has("warriorAttacked")).toBe(true);
    expect(types.has("gameWon")).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const again = generateTrace({
      pool,
      player1Faction: "Monk",
      player2Faction: "Dwarf",
      seed: 123,
      maxTurns: 20,
    });
    expect(again).toEqual(trace);
  });

  it("stops at the max-turn cap when set low", () => {
    const capped = generateTrace({
      pool,
      player1Faction: "Monk",
      player2Faction: "Dwarf",
      seed: 123,
      maxTurns: 1,
    });
    expect(capped.reason).toBe("maxTurns");
    expect(capped.winner).toBeNull();
    expect(capped.turns).toBeLessThanOrEqual(2);
  });
});

describe("formatTrace", () => {
  it("renders the required sections in readable text", () => {
    const text = formatTrace(trace);
    expect(text).toContain("Monk (player1) vs Dwarf (player2)");
    expect(text).toContain("opening hands:");
    expect(text).toContain("── Turn 1 · player1 (Monk) ──");
    expect(text).toContain("draw:");
    expect(text).toContain("summon:");
    expect(text).toContain("attack:");
    expect(text).toContain("DIRECT ATTACK");
    expect(text).toMatch(/result: player[12] \(\w+\) — reason: win/);
  });

  it("resolves card and instance names rather than raw ids", () => {
    const text = formatTrace(trace);
    // No bare engine instance ids like "warrior-1 " appear without a name in
    // front (we render "Name [warrior-1]"); a summon line proves the format.
    expect(text).toMatch(/summon: .+ \[warrior-\d+\] \(cost \d+\)/);
  });

  it("is deterministic for a fixed seed", () => {
    expect(formatTrace(trace)).toBe(formatTrace(trace));
  });
});
