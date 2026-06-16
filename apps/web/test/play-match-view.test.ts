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
import { createCardDetail } from "../src/detail";

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

  it("does not offer/enable a second Warrior summon the same turn", () => {
    const match = newMatch(); // seed 1: opening hand holds several Warriors
    // Plenty of Spirit so leftover Warriors aren't disabled for cost reasons —
    // isolating the one-summon-per-turn rule.
    match.state().players.player1.spirit = 99;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    // No enabled Summon control remains this turn.
    expect(buttonByText(root, ".play-match__card-btn", "Summon")).toBeUndefined();
    // Remaining Warriors are shown disabled with the limit reason.
    const limited = buttonByText(root, ".play-match__card-btn", "One summon per turn");
    expect(limited).toBeDefined();
    expect(limited!.disabled).toBe(true);
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

/** Ends turns until the AI opponent has at least one Warrior on its field. */
function matchWithOpponentWarrior(seed: number) {
  const match = newMatch(seed);
  let guard = 0;
  while (
    !match.isOver() &&
    match.state().players.player2.field.length === 0 &&
    guard < 50
  ) {
    const endTurn = match.legalActions().find((a) => a.kind === "endTurn");
    if (endTurn === undefined) break;
    match.apply(endTurn);
    guard += 1;
  }
  return match;
}

describe("renderPlayableMatch — card inspection", () => {
  it("opens the detail modal (onInspect) when a hand card body is tapped", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const body = root.querySelector<HTMLButtonElement>(".play-match__card-inspect");
    expect(body).not.toBeNull();
    body!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    // The inspected card is a real card with the displayed name.
    const card = onInspect.mock.calls[0]![0];
    expect(typeof card.name).toBe("string");
    expect(body!.textContent).toContain(card.name);
  });

  it("does NOT inspect when a gameplay action button is clicked", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const summon = buttonByText(root, ".play-match__card-btn", "Summon")!;
    summon.click();
    // Summon performed, modal never opened.
    expect(match.state().players.player1.field.length).toBe(1);
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("lets the opponent's field cards be inspected", () => {
    const match = matchWithOpponentWarrior(5);
    expect(match.state().players.player2.field.length).toBeGreaterThan(0);
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const oppBody = root.querySelector<HTMLButtonElement>(
      ".play-match__field--theirs .play-match__warrior-inspect",
    );
    expect(oppBody).not.toBeNull();
    oppBody!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(typeof onInspect.mock.calls[0]![0].name).toBe("string");
  });

  it("lets your own field cards be inspected after summoning", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    const mineBody = root.querySelector<HTMLButtonElement>(
      ".play-match__field--mine .play-match__warrior-inspect",
    );
    expect(mineBody).not.toBeNull();
    mineBody!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("renders the inspection affordance hint", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelector(".play-match__hint")?.textContent?.toLowerCase()).toContain(
      "details",
    );
  });
});

describe("shared card-detail modal (reused by Card Viewer / Deck Builder / match)", () => {
  // showModal/close are not implemented in jsdom; stub them so the reused modal
  // can be exercised through the DOM exactly as the app wires it.
  function openableDetail() {
    const detail = createCardDetail("/");
    (detail.element as unknown as { showModal: () => void }).showModal = vi.fn();
    document.body.append(detail.element);
    return detail;
  }

  it("shows the card image, name, stats, and rules text", () => {
    const warrior = cards.find((c) => c.type === "Warrior")!;
    const detail = openableDetail();
    detail.open(warrior);
    const el = detail.element;
    const art = el.querySelector<HTMLImageElement>(".detail__art")!;
    expect(art.alt).toBe(warrior.name);
    expect(art.getAttribute("src")).toBeTruthy();
    expect(el.querySelector(".detail__name")?.textContent).toBe(warrior.name);
    const stats = el.querySelector(".detail__stats")?.textContent ?? "";
    expect(stats).toContain("Faction");
    expect(stats).toContain(warrior.faction);
    expect(stats).toContain("Cost");
    expect(stats).toContain("Attack");
    // Rules row is always present (real text or the empty-state fallback).
    expect(el.querySelector(".detail__rules")).not.toBeNull();
  });

  it("uses the missing-art fallback when the image fails to load", () => {
    const detail = openableDetail();
    detail.open(cards[0]!);
    const art = detail.element.querySelector<HTMLImageElement>(".detail__art")!;
    art.dispatchEvent(new Event("error"));
    expect(art.classList.contains("detail__art--missing")).toBe(true);
    expect(art.hasAttribute("src")).toBe(false);
  });

  it("closes via the close button and via a backdrop click", () => {
    const detail = openableDetail();
    detail.open(cards[0]!);
    const closeFn = vi.fn();
    (detail.element as unknown as { close: () => void }).close = closeFn;
    detail.element.querySelector<HTMLButtonElement>(".detail__close")!.click();
    expect(closeFn).toHaveBeenCalledTimes(1);
    // Clicking the dialog backdrop (target === dialog) also closes it.
    detail.element.click();
    expect(closeFn).toHaveBeenCalledTimes(2);
  });
});
