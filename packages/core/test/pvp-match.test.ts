/**
 * PvP live-match controller (pvp-match.ts): two controllers — creator (player1)
 * and joiner (player2) — synced through a fake in-memory pvp_matches table with
 * real optimistic-version semantics. Verifies turn ownership, action-log sync,
 * remote frames, mid-game join (log replay), concede, divergence freezing, and
 * that a full deterministic game stays identical on both clients.
 */
import { describe, expect, it, vi } from "vitest";
import { smartAgent } from "@euphoria/simulator";
import { cards } from "@euphoria/core/cards";
import { createPvpMatch, PvpMatchError, type PvpPlayableMatch } from "../src/pvp-match";
import type { MatchFrame } from "../src/play-match";
import type { PvpClient, PvpMatch } from "../src/pvp";

const A = "user-a"; // creator → seat player1
const B = "user-b"; // joiner → seat player2

function matchRow(over: Partial<PvpMatch> = {}): PvpMatch {
  return {
    id: "match-1",
    room_id: "room-1",
    player_one: A,
    player_two: B,
    seed: 5,
    player_one_deck: { faction: "Sonic", entries: null },
    player_two_deck: { faction: "Dwarf", entries: null },
    current_player: A,
    status: "active",
    action_log: [],
    version: 0,
    winner: null,
    ...over,
  };
}

/**
 * An in-memory stand-in for the pvp_matches row + Supabase subscription, with
 * the same optimistic-version contract as the real client. Both controllers
 * share one table, so a push from either side notifies both.
 */
function fakeMatchClient(initial: PvpMatch): {
  client: PvpClient;
  row: () => PvpMatch;
} {
  let row = initial;
  const subs = new Set<(m: PvpMatch) => void>();
  const unsupported = (): never => {
    throw new Error("lobby operation not used in these tests");
  };
  const client: PvpClient = {
    createRoom: unsupported,
    joinByCode: unsupported,
    getRoom: unsupported,
    setReady: unsupported,
    leaveRoom: unsupported,
    subscribeRoom: unsupported,
    startMatch: unsupported,
    async getMatch() {
      return row;
    },
    async pushMatch(_id, expectedVersion, patch) {
      if (row.version !== expectedVersion) {
        return { ok: false, conflict: true, message: "conflict" };
      }
      row = { ...row, ...patch, version: expectedVersion + 1 };
      for (const cb of [...subs]) cb(row);
      return { ok: true, match: row };
    },
    subscribeMatch(_id, onChange) {
      subs.add(onChange);
      return () => subs.delete(onChange);
    },
  };
  return { client, row: () => row };
}

/** Lets queued pushes and subscription callbacks settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function duel(over: Partial<PvpMatch> = {}) {
  const { client, row } = fakeMatchClient(matchRow(over));
  const creator = createPvpMatch({
    match: row(),
    userId: A,
    pool: cards,
    client,
    retryDelayMs: 0,
  });
  const joiner = createPvpMatch({
    match: row(),
    userId: B,
    pool: cards,
    client,
    retryDelayMs: 0,
  });
  return { client, row, creator, joiner };
}

describe("createPvpMatch — seating and setup", () => {
  it("seats the creator as player1 and the joiner as player2, factions viewer-relative", () => {
    const { creator, joiner } = duel();
    expect(creator.mySeat).toBe("player1");
    expect(joiner.mySeat).toBe("player2");
    expect(creator.playerFaction).toBe("Sonic");
    expect(creator.opponentFaction).toBe("Dwarf");
    expect(joiner.playerFaction).toBe("Dwarf");
    expect(joiner.opponentFaction).toBe("Sonic");
    // Identical canonical opening state on both clients.
    expect(creator.state()).toEqual(joiner.state());
  });

  it("rejects a non-participant and an invalid deck payload", () => {
    const { client, row } = fakeMatchClient(matchRow());
    expect(() =>
      createPvpMatch({ match: row(), userId: "stranger", pool: cards, client }),
    ).toThrow(PvpMatchError);
    expect(() =>
      createPvpMatch({
        match: matchRow({ player_one_deck: null }),
        userId: A,
        pool: cards,
        client,
      }),
    ).toThrow(/deck/);
  });

  it("enforces turn ownership on both sides", () => {
    const { creator, joiner } = duel();
    expect(creator.legalActions().length).toBeGreaterThan(0);
    expect(joiner.legalActions()).toEqual([]);
    const res = joiner.apply({ kind: "endTurn" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/not your turn/i);
  });
});

describe("createPvpMatch — action sync", () => {
  it("delivers the local action to the opponent as remote frames", async () => {
    const { creator, joiner } = duel();
    const received: MatchFrame[][] = [];
    joiner.subscribeRemote((frames) => received.push(frames));

    const end = creator.legalActions().find((a) => a.kind === "endTurn")!;
    const res = creator.apply(end);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.frames).toHaveLength(1);
      expect(res.frames[0]!.actor).toBe("player");
    }
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]!).toHaveLength(1);
    expect(received[0]![0]!.actor).toBe("opponent");
    // Control passed: now the joiner may act and the creator may not.
    expect(joiner.state().activePlayer).toBe("player2");
    expect(joiner.legalActions().length).toBeGreaterThan(0);
    expect(creator.legalActions()).toEqual([]);
    expect(creator.state()).toEqual(joiner.state());
  });

  it("syncs a full turn round-trip and keeps the shared log canonical", async () => {
    const { creator, joiner, row } = duel();
    creator.apply(creator.legalActions().find((a) => a.kind === "endTurn")!);
    await settle();
    joiner.apply(joiner.legalActions().find((a) => a.kind === "endTurn")!);
    await settle();
    expect(row().action_log).toHaveLength(2);
    expect(row().version).toBe(2);
    expect(row().current_player).toBe(A); // back to the creator
    expect(creator.state()).toEqual(joiner.state());
    expect(creator.history()).toEqual(joiner.history());
  });

  it("lets a client mount mid-game by replaying the shared log", async () => {
    const { creator, joiner, client, row } = duel();
    creator.apply(creator.legalActions().find((a) => a.kind === "endTurn")!);
    await settle();
    joiner.apply(joiner.legalActions().find((a) => a.kind === "endTurn")!);
    await settle();
    // A reload: a fresh controller built from the current row.
    const rejoined = createPvpMatch({
      match: row(),
      userId: B,
      pool: cards,
      client,
      retryDelayMs: 0,
    });
    expect(rejoined.state()).toEqual(creator.state());
    expect(rejoined.history()).toHaveLength(2);
  });

  it("plays a whole deterministic game identically on both clients", { timeout: 30_000 }, async () => {
    const { creator, joiner, row } = duel();
    const agent = smartAgent();
    // Drive both seats with the AI picker purely through the public surface —
    // exactly what two humans would produce, just faster. Yield to the event
    // loop only when the turn passed (that's when the other client must catch
    // up via its subscription); mid-turn actions need no settling.
    for (let steps = 0; steps < 600 && !creator.isOver() && !joiner.isOver(); steps += 1) {
      const mover: PvpPlayableMatch =
        creator.legalActions().length > 0 ? creator : joiner;
      const legal = mover.legalActions();
      if (legal.length === 0) {
        await settle(); // waiting on the other client's push
        continue;
      }
      const res = mover.apply(agent(mover.state(), legal));
      expect(res.ok).toBe(true);
      if (mover.legalActions().length === 0) await settle();
    }
    await settle(); // let the final push (winner/status) land
    expect(creator.isOver()).toBe(true);
    expect(joiner.isOver()).toBe(true);
    expect(creator.state()).toEqual(joiner.state());
    expect(row().status).toBe("completed");
    const winnerSeat = creator.state().winner!;
    expect(row().winner).toBe(winnerSeat === "player1" ? A : B);
    // Viewer-relative summaries: exactly one side won.
    const cs = creator.summary();
    const js = joiner.summary();
    expect(cs.playerWon).not.toBe(js.playerWon);
    expect(cs.turns).toBe(js.turns);
  });
});

describe("createPvpMatch — concede and sync failures", () => {
  it("concede closes the match with the opponent as winner on both clients", async () => {
    const { creator, joiner, row } = duel();
    const notified: MatchFrame[][] = [];
    creator.subscribeRemote((frames) => notified.push(frames));

    await joiner.concede();
    await settle();

    expect(row().status).toBe("abandoned");
    expect(row().winner).toBe(A);
    expect(joiner.isOver()).toBe(true);
    expect(creator.isOver()).toBe(true);
    // The creator was told (empty frames → repaint + isOver check).
    expect(notified.some((f) => f.length === 0)).toBe(true);
    expect(creator.summary().playerWon).toBe(true);
    expect(creator.summary().highlights[0]).toMatch(/conceded/i);
    expect(joiner.summary().playerWon).toBe(false);
  });

  it("surfaces a sync error when pushes keep failing", async () => {
    const { client, row } = fakeMatchClient(matchRow());
    const failing: PvpClient = {
      ...client,
      pushMatch: vi.fn().mockResolvedValue({ ok: false, conflict: false, message: "offline" }),
    };
    const errors: string[] = [];
    const solo = createPvpMatch({
      match: row(),
      userId: A,
      pool: cards,
      client: failing,
      retryDelayMs: 0,
      onSyncError: (m) => errors.push(m),
    });
    const res = solo.apply(solo.legalActions().find((a) => a.kind === "endTurn")!);
    expect(res.ok).toBe(true); // the local board still advanced
    await settle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/offline/);
    expect(failing.pushMatch).toHaveBeenCalledTimes(3); // retried
  });

  it("freezes the board when the shared log diverges from ours", async () => {
    const { client, row } = fakeMatchClient(matchRow());
    const errors: string[] = [];
    const solo = createPvpMatch({
      match: row(),
      userId: A,
      pool: cards,
      client,
      retryDelayMs: 0,
      onSyncError: (m) => errors.push(m),
    });
    // A hostile/corrupt write: an action that can never apply.
    await client.pushMatch("match-1", 0, {
      action_log: [{ kind: "attack", attackerInstanceId: "nope", defenderInstanceId: "nope" } as never],
      current_player: B,
    });
    await settle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/out of sync/i);
    expect(solo.isOver()).toBe(true);
    expect(solo.legalActions()).toEqual([]);
  });
});
