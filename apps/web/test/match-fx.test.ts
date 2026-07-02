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
import {
  attachMatchFx,
  ATTACK_CARD_FX_EVENT,
  type AttackCardFxDetail,
} from "../src/match-fx";

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

describe("attachMatchFx — faction signatures", () => {
  const FACTIONS: ReadonlyArray<[string, string]> = [
    ["Dwarf", "dwarf"],
    ["Monk", "monk"],
    ["Surfer", "surfer"],
    ["Sonic", "sonic"],
    ["Shaman", "shaman"],
    ["Human", "human"],
    ["Neutral", "neutral"],
    ["Criminal", "criminal"],
  ];

  it("stamps every recognized faction's modifier and energy token", () => {
    for (const [faction, slug] of FACTIONS) {
      const board = makeBoard();
      const detach = attachMatchFx(board, {
        playerFaction: faction,
        opponentFaction: "Neutral",
      });
      fire(board, { kind: "summon", actor: "player", targetInstanceId: "warrior-1" });
      const node = board.querySelector<HTMLElement>(".match-fx--burst")!;
      expect(node.classList.contains(`match-fx--${slug}`)).toBe(true);
      expect(node.style.getPropertyValue("--fx-energy")).toBe(
        `var(--eu-energy-${slug})`,
      );
      detach();
      board.remove();
    }
  });

  it("falls back to the base template + Neutral energy for unknown factions", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, {
      playerFaction: "Mystery",
      opponentFaction: "Neutral",
    });
    fire(board, { kind: "summon", actor: "player", targetInstanceId: "warrior-1" });
    const node = board.querySelector<HTMLElement>(".match-fx--burst")!;
    expect(node.className).toBe("match-fx match-fx--burst"); // no modifier
    expect(node.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-neutral)");
    detach();
  });

  it("Dwarf hits request the micro-shake without crashing where WAAPI is absent", () => {
    const board = makeBoard();
    const animate = vi.fn();
    (board as HTMLElement & { animate?: unknown }).animate = animate;
    const detach = attachMatchFx(board, {
      playerFaction: "Dwarf",
      opponentFaction: "Monk",
    });
    fire(board, { kind: "damage", actor: "player", targetInstanceId: "warrior-1" });
    expect(animate).toHaveBeenCalledTimes(1);
    // Throttled: an immediate second hit shakes once, not twice.
    fire(board, { kind: "damage", actor: "player", targetInstanceId: "warrior-1" });
    expect(animate).toHaveBeenCalledTimes(1);
    // Non-Dwarf actors never shake.
    fire(board, { kind: "damage", actor: "opponent", targetInstanceId: "warrior-1" });
    expect(animate).toHaveBeenCalledTimes(1);
    // And a board without Element.animate (jsdom default) is a silent no-op.
    delete (board as unknown as { animate?: unknown }).animate;
    fire(board, { kind: "directAttack", actor: "player", targetPlayer: "player2" });
    expect(board.querySelectorAll(".match-fx--impact").length).toBeGreaterThan(0);
    detach();
  });
});

describe("attachMatchFx — attack-card super move", () => {
  const superDetail = (over: Partial<AttackCardFxDetail> = {}): AttackCardFxDetail => ({
    cardName: "Serf's Bondage",
    artUrl: "/beta/cards/x.png",
    actor: "player",
    targetInstanceId: "warrior-1",
    ...over,
  });
  const fireSuper = (board: HTMLElement, detail: AttackCardFxDetail): void => {
    board.dispatchEvent(new CustomEvent(ATTACK_CARD_FX_EVENT, { detail }));
  };

  it("renders veil, speed lines, card art, and the name in the actor's energy", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fireSuper(board, superDetail());
    const overlay = board.querySelector<HTMLElement>(".match-fx-super")!;
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains("match-fx-super--player")).toBe(true);
    expect(overlay.classList.contains("match-fx--monk")).toBe(true);
    expect(overlay.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-monk)");
    expect(overlay.querySelectorAll(".match-fx-super__line")).toHaveLength(3);
    expect(overlay.querySelector<HTMLImageElement>(".match-fx-super__art")!.src).toContain("x.png");
    expect(overlay.querySelector(".match-fx-super__name")!.textContent).toBe("Serf's Bondage");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    detach();
  });

  it("uses the opponent entry side + their faction for opponent supers", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fireSuper(board, superDetail({ actor: "opponent" }));
    const overlay = board.querySelector<HTMLElement>(".match-fx-super")!;
    expect(overlay.classList.contains("match-fx-super--opponent")).toBe(true);
    expect(overlay.style.getPropertyValue("--fx-energy")).toBe("var(--eu-energy-dwarf)");
    detach();
  });

  it("falls back to a text card face without art", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fireSuper(board, superDetail({ artUrl: undefined }));
    const face = board.querySelector(".match-fx-super__card--text")!;
    expect(face.textContent).toBe("Serf's Bondage");
    expect(board.querySelector(".match-fx-super__art")).toBeNull();
    detach();
  });

  it("lands the impact cue + shake at the slam beat, then cleans up", () => {
    vi.useFakeTimers();
    try {
      const board = makeBoard();
      const animate = vi.fn();
      (board as HTMLElement & { animate?: unknown }).animate = animate;
      const detach = attachMatchFx(board, OPTS);
      fireSuper(board, superDetail());
      expect(board.querySelector(".match-fx--impact")).toBeNull(); // not yet
      vi.advanceTimersByTime(400);
      expect(board.querySelector(".match-fx--impact")).not.toBeNull();
      expect(animate).toHaveBeenCalledTimes(1); // the slam shake
      vi.advanceTimersByTime(500);
      expect(board.querySelector(".match-fx-super")).toBeNull(); // overlay gone
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces a live super instead of stacking", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fireSuper(board, superDetail());
    fireSuper(board, superDetail({ cardName: "Pisubaipa" }));
    const overlays = board.querySelectorAll(".match-fx-super");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.querySelector(".match-fx-super__name")!.textContent).toBe("Pisubaipa");
    detach();
  });

  it("reduced motion gets the calm lite variant: no lines, no shake", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    try {
      const board = makeBoard();
      const animate = vi.fn();
      (board as HTMLElement & { animate?: unknown }).animate = animate;
      const detach = attachMatchFx(board, OPTS);
      fireSuper(board, superDetail());
      const overlay = board.querySelector<HTMLElement>(".match-fx-super")!;
      expect(overlay.classList.contains("match-fx-super--lite")).toBe(true);
      expect(overlay.querySelectorAll(".match-fx-super__line")).toHaveLength(0);
      vi.advanceTimersByTime(500);
      expect(animate).not.toHaveBeenCalled(); // no impact shake in lite
      expect(board.querySelector(".match-fx-super")).toBeNull(); // shorter life
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("detach removes a live super overlay and its listener", () => {
    const board = makeBoard();
    const detach = attachMatchFx(board, OPTS);
    fireSuper(board, superDetail());
    expect(board.querySelector(".match-fx-super")).not.toBeNull();
    detach();
    expect(board.querySelector(".match-fx-super")).toBeNull();
    fireSuper(board, superDetail());
    expect(board.querySelector(".match-fx-super")).toBeNull();
  });
});
