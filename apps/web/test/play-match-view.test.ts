/**
 * @vitest-environment jsdom
 *
 * Interactive match board (play-match-view.ts), driven through the DOM with
 * jsdom: legal-action rendering, disabled states for illegal plays, the summon
 * flow via a button click, and that a finished match fires onComplete with the
 * summary (so the result/history/reward flow downstream still runs).
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { createPlayableMatch } from "../src/play-match";
import { renderPlayableMatch } from "../src/play-match-view";

const noop = (): void => {};

function newMatch(seed = 1) {
  return createPlayableMatch({
    faction: "Sonic",
    pool: cards,
    seed,
    opponentFaction: "Dwarf",
  });
}

function buttonByText(root: HTMLElement, selector: string, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(selector)).find(
    (b) => b.textContent === text,
  );
}

describe("renderPlayableMatch — legal-action rendering", () => {
  it("renders the hand, an End Turn button, and a Summon control", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelectorAll(".play-match__card").length).toBeGreaterThan(0);
    const endTurn = root.querySelector<HTMLButtonElement>(".play-match__end");
    expect(endTurn).not.toBeNull();
    expect(endTurn!.disabled).toBe(false);
    expect(buttonByText(root, ".play-match__card-btn", "Summon")).toBeDefined();
  });

  it("shows both stat bars with lives and Spirit", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelectorAll(".play-match__stats").length).toBe(2);
    expect(root.querySelectorAll(".play-match__stat--lives").length).toBe(2);
    expect(root.querySelectorAll(".play-match__stat--spirit").length).toBe(2);
  });

  it("disables hand controls once Battle Phase is entered", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const enter = root.querySelector<HTMLButtonElement>(".play-match__enter")!;
    expect(enter.disabled).toBe(false);
    enter.click();
    // In Battle Phase no Warrior is summonable, so its control is disabled with
    // a reason rather than removed.
    const disabled = buttonByText(root, ".play-match__card-btn", "Not during Battle");
    expect(disabled).toBeDefined();
    expect(disabled!.disabled).toBe(true);
  });
});

describe("renderPlayableMatch — summon flow", () => {
  it("summons a Warrior to the field when its button is clicked", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(match.state().players.player1.field.length).toBe(0);
    const summon = buttonByText(root, ".play-match__card-btn", "Summon")!;
    summon.click();
    expect(match.state().players.player1.field.length).toBe(1);
    // The board re-rendered in place: a warrior tile now exists.
    expect(root.querySelectorAll(".play-match__field--mine .play-match__warrior").length).toBe(1);
  });
});

describe("renderPlayableMatch — completion", () => {
  it("fires onComplete with the summary when the match is already over", () => {
    // Drive the underlying match to completion first; the board's initial paint
    // then sees an over match and reports the summary immediately.
    const match = newMatch(3);
    let guard = 0;
    while (!match.isOver() && guard < 500) {
      const endTurn = match.legalActions().find((a) => a.kind === "endTurn");
      if (endTurn === undefined) break;
      match.apply(endTurn);
      guard += 1;
    }
    expect(match.isOver()).toBe(true);

    const onComplete = vi.fn();
    renderPlayableMatch(match, { onComplete, onQuit: noop });
    expect(onComplete).toHaveBeenCalledTimes(1);
    const summary = onComplete.mock.calls[0]![0];
    expect(summary.playerFaction).toBe("Sonic");
    expect(["win", "loss", "draw"]).toContain(summary.outcome);
  });
});
