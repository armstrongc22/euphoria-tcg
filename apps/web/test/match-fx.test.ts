/**
 * @vitest-environment jsdom
 *
 * Match FX layer (match-fx.ts): the decorative subscriber over the board's
 * existing MATCH_ANIM_EVENT seam. Verifies spawning per moment kind, faction
 * energy + Monk tuning, the concurrency cap, the turn-change wipe, and every
 * kill switch (noAnim flag, reduced motion, detach). No engine or match code
 * is involved — the "board" is a plain element firing the same CustomEvents.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MATCH_ANIM_EVENT,
  type MatchAnimDetail,
} from "@euphoria/core/match-playback";
import { FLAG_NO_ANIM, setFlag } from "../src/debug-flags";
import { attachMatchFx } from "../src/match-fx";

function makeBoard(): HTMLElement {
  const board = document.createElement("section");
  const tile = document.createElement("div");
  tile.setAttribute("data-instance", "warrior-1");
  const seat = document.createElement("div");
  seat.setAttribute("data-seat", "player2");
  board.append(tile, seat);
  document.body.append(board);
  return board;
}

function fire(board: HTMLElement, detail: Partial<MatchAnimDetail>): void {
  board.dispatchEvent(
    new CustomEvent(MATCH_ANIM_EVENT, {
      detail: { kind: "info", actor: "player", ...detail },
    }),
  );
}

const OPTS = { playerFaction: "Monk", opponentFaction: "Dwarf" };

/** MutationObserver callbacks are microtasks; let them run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  setFlag(FLAG_NO_ANIM, false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("attachMatchFx — spawning", () => {
  it("spawns a summon burst on the acting tile with the actor's energy", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "summon", actor: "player", targetInstanceId: "warrior-1" });
    const node = board.querySelector<HTMLElement>(".match-fx--burst");
    expect(node).not.toBeNull();
    expect(node!.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-monk)");
    expect(node!.classList.contains("match-fx--monk")).toBe(true); // tuned faction
    expect(node!.getAttribute("aria-hidden")).toBe("true");
    detach();
  });

  it("uses the opponent's faction (no Monk tuning) for opponent moments", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "attack", actor: "opponent", targetInstanceId: "warrior-1" });
    const node = board.querySelector<HTMLElement>(".match-fx--impact")!;
    expect(node.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-dwarf)");
    expect(node.classList.contains("match-fx--monk")).toBe(false);
    detach();
  });

  it("maps the moment kinds to their templates (and anchors direct hits to the seat)", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "heal", targetInstanceId: "warrior-1" });
    expect(board.querySelector(".match-fx--rise")).not.toBeNull();
    fire(board, { kind: "destroy", targetInstanceId: "warrior-1" });
    expect(board.querySelector(".match-fx--shatter")).not.toBeNull();
    fire(board, { kind: "directAttack", targetPlayer: "player2" });
    expect(board.querySelectorAll(".match-fx--impact")).toHaveLength(1);
    detach();
  });

  it("spawns nothing for undecorated kinds or a missing anchor", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "draw" });
    fire(board, { kind: "info" });
    fire(board, { kind: "summon", targetInstanceId: "no-such-warrior" });
    expect(board.querySelectorAll(".match-fx")).toHaveLength(0);
    detach();
  });

  it("caps concurrent FX nodes", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    for (let i = 0; i < 12; i += 1) {
      fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
    }
    expect(board.querySelectorAll(".match-fx").length).toBeLessThanOrEqual(6);
    detach();
  });

  it("cleans nodes up after their lifetime", () => {
    vi.useFakeTimers();
    try {
      const board = makeBoard();
      const detach = attachMatchFx(board, OPTS);
      fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
      expect(board.querySelector(".match-fx")).not.toBeNull();
      vi.advanceTimersByTime(600);
      expect(board.querySelector(".match-fx")).toBeNull();
      detach();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("attachMatchFx — turn wipe", () => {
  const phase = (tone: "you" | "opponent"): HTMLElement => {
    const el = document.createElement("div");
    el.className = `play-match__phase play-match__phase--${tone}`;
    return el;
  };

  it("sweeps a wipe when the phase banner tone flips, colored by the new side", async () => {
    const board = makeBoard();
    board.append(phase("you"));
    const detach = attachMatchFx(board, OPTS);
    // A repaint with the SAME tone: no wipe.
    board.append(phase("you"));
    await tick();
    expect(board.querySelector(".match-fx--turn")).toBeNull();
    // The tone flips to the opponent: wipe in the opponent's energy.
    board.querySelectorAll(".play-match__phase").forEach((el) => el.remove());
    board.append(phase("opponent"));
    await tick();
    const wipe = board.querySelector<HTMLElement>(".match-fx--turn");
    expect(wipe).not.toBeNull();
    expect(wipe!.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-dwarf)");
    detach();
  });
});

describe("attachMatchFx — kill switches", () => {
  it("is a no-op under the euphoriaNoAnim flag", () => {
    setFlag(FLAG_NO_ANIM, true);
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
    expect(board.querySelectorAll(".match-fx")).toHaveLength(0);
    detach();
  });

  it("spawns nothing under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
    expect(board.querySelectorAll(".match-fx")).toHaveLength(0);
    detach();
  });

  it("detach removes the listener, timers, and any live nodes", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
    expect(board.querySelector(".match-fx")).not.toBeNull();
    detach();
    expect(board.querySelector(".match-fx")).toBeNull();
    fire(board, { kind: "summon", targetInstanceId: "warrior-1" });
    expect(board.querySelector(".match-fx")).toBeNull();
  });
});
