/**
 * @vitest-environment jsdom
 *
 * Interactive match board (play-match-view.ts), driven through the DOM with
 * jsdom: legal-action rendering, disabled states for illegal plays, the summon
 * flow via a button click, and that a finished match fires onComplete with the
 * summary (so the result/history/reward flow downstream still runs).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@euphoria/card-data/schema";
import type { GameState, WarriorInPlay } from "@euphoria/game-engine";
import { smartAgent } from "@euphoria/simulator";
import { cards } from "@euphoria/core/cards";
import { createPlayableMatch } from "@euphoria/core/play-match";
import {
  battleLogLines,
  renderPlayableMatch,
  MATCH_ANIM_EVENT,
  MAX_RENDERED_LOG_ENTRIES,
  type MatchAnimDetail,
} from "../src/play-match-view";
import { createCardDetail } from "../src/detail";

/** Minimal in-play Warrior for white-box board scenarios. */
function wip(card: Card, instanceId: string): WarriorInPlay {
  return {
    instanceId,
    card,
    currentAttack: card.attack ?? 1000,
    currentHealth: card.health ?? 2000,
    maxHealth: card.health ?? 2000,
    attacksRemaining: 1,
    temporaryAttackBuffs: [],
  };
}

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
  it("opens the detail modal (onInspect) via the card's inspect button", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    // The inspect affordance is now a small dedicated button on the card tile.
    const card = root.querySelector<HTMLElement>(".play-match__card")!;
    const inspectBtn = card.querySelector<HTMLButtonElement>(".play-match__card-inspect");
    expect(inspectBtn).not.toBeNull();
    inspectBtn!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    // The inspected card is a real card whose name is shown on the tile face.
    const inspected = onInspect.mock.calls[0]![0];
    expect(typeof inspected.name).toBe("string");
    expect(card.querySelector(".play-match__card-name")?.textContent).toContain(
      inspected.name,
    );
  });

  it("places the hand-card inspect button in the art region with an aria-label", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const card = root.querySelector<HTMLElement>(".play-match__card")!;
    const artWrap = card.querySelector<HTMLElement>(".play-match__art-wrap");
    expect(artWrap).not.toBeNull();
    const inspectBtn = artWrap!.querySelector<HTMLButtonElement>(".play-match__card-inspect");
    // The inspect button lives inside the art region (anchored bottom-right via
    // CSS), keeping its accessible label, and still opens the detail modal.
    expect(inspectBtn).not.toBeNull();
    expect(inspectBtn!.getAttribute("aria-label")).toMatch(/^Inspect /);
    inspectBtn!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("places a field Warrior's inspect button in the art region, not over the stat overlay", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    const warrior = root.querySelector<HTMLElement>(
      ".play-match__field--mine .play-match__warrior",
    )!;
    const artWrap = warrior.querySelector<HTMLElement>(".play-match__art-wrap")!;
    // Both the ATK/HP overlay and the inspect button share the art region; the
    // inspect button is a distinct element (positioned bottom-right in CSS).
    expect(artWrap.querySelector(".play-match__warrior-overlay")).not.toBeNull();
    const inspectBtn = artWrap.querySelector<HTMLButtonElement>(".play-match__warrior-inspect");
    expect(inspectBtn).not.toBeNull();
    expect(inspectBtn!.getAttribute("aria-label")).toMatch(/^Inspect /);
    inspectBtn!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("tapping a card selects it and opens the selected-card action panel", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelector(".play-match__selected")).toBeNull();
    // Find the card that offers Summon (a Warrior) and select it via its face.
    const summon = buttonByText(root, ".play-match__card-btn", "Summon")!;
    const card = summon.closest<HTMLElement>(".play-match__card")!;
    card.querySelector<HTMLElement>(".play-match__card-face")!.click();
    const panel = root.querySelector(".play-match__selected");
    expect(panel).not.toBeNull();
    // The panel hosts the card's actions (Summon) + an Inspect button.
    expect(panel!.querySelector(".play-match__selected-inspect")).not.toBeNull();
    expect(
      buttonByText(root, ".play-match__selected-actions .play-match__card-btn", "Summon"),
    ).toBeDefined();
    // And the action still performs (Feature B: panel actions work).
    buttonByText(root, ".play-match__selected-actions .play-match__card-btn", "Summon")!.click();
    expect(match.state().players.player1.field.length).toBe(1);
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

describe("renderPlayableMatch — Totem's Creation revive (Bug A)", () => {
  const totems = (): Card => {
    const c = cards.find((card) => card.slug === "totems-creation");
    if (c === undefined) throw new Error("totems-creation missing from pool");
    return c;
  };
  const aWarrior = (): Card => cards.find((c) => c.type === "Warrior")!;

  function craftRevive(outDeck: Card[]): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [totems()];
    s.players.player1.field = [];
    s.players.player1.outDeck = outDeck;
    return match;
  }

  it("disables Totem's Creation when no valid Out-Deck Warrior exists", () => {
    const match = craftRevive([]); // empty Out Deck
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const btn = buttonByText(root, ".play-match__card-btn", "No Warrior to revive");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  it("excludes non-Warrior Out-Deck cards as revive targets", () => {
    const item = cards.find((c) => c.type === "Item" && c.slug !== "totems-creation")!;
    const match = craftRevive([item]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "No Warrior to revive")).toBeDefined();
  });

  it("shows valid Out-Deck Warrior targets when Play is clicked", () => {
    const fallen = aWarrior();
    const match = craftRevive([fallen]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    const panel = root.querySelector(".play-match__choice");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain(fallen.name);
  });

  it("revives the chosen Warrior, passing the correct target", () => {
    const fallen = aWarrior();
    const match = craftRevive([fallen]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__choice-btn", `Revive ${fallen.name}`)!.click();

    const p1 = match.state().players.player1;
    expect(p1.field.map((w) => w.card.id)).toContain(fallen.id);
    expect(p1.outDeck.map((c) => c.id)).not.toContain(fallen.id);
    // Totem's Creation was spent.
    expect(p1.hand.some((c) => c.slug === "totems-creation")).toBe(false);
  });

  it("cancels a revive choice without corrupting state", () => {
    const fallen = aWarrior();
    const match = craftRevive([fallen]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__choice-cancel")!.click();
    expect(root.querySelector(".play-match__choice")).toBeNull();
    // Nothing played: card still in hand, Out Deck Warrior untouched.
    expect(match.state().players.player1.hand.some((c) => c.slug === "totems-creation")).toBe(true);
    expect(match.state().players.player1.outDeck.map((c) => c.id)).toContain(fallen.id);
  });

  it("shows 'Field is full' instead of reviving when the field is full", () => {
    const fallen = aWarrior();
    const match = craftRevive([fallen]);
    const s = match.state();
    s.players.player1.field = Array.from({ length: s.config.warriorSlots }, (_, i) =>
      wip(aWarrior(), `full-${i}`),
    );
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const btn = buttonByText(root, ".play-match__card-btn", "Field is full");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });
});

describe("renderPlayableMatch — Attack-card prompt (Bug B)", () => {
  const anAttackCard = (): Card => {
    const c = cards.find((card) => card.type === "Attack");
    if (c === undefined) throw new Error("no Attack card in pool");
    return c;
  };
  const warriorOfFaction = (faction: string): Card => {
    const c = cards.find((card) => card.type === "Warrior" && card.faction === faction);
    if (c === undefined) throw new Error(`no Warrior for faction ${faction}`);
    return c;
  };

  /** Battle scenario: P1 has `friendly` on field and `hand` in hand vs one enemy. */
  function craftBattle(
    friendly: Card,
    hand: Card[],
    spirit: number,
    opponentEmpty = false,
  ): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.phase = "battle";
    s.turn = 3; // not turn 1, so attacks are allowed
    s.activePlayer = "player1";
    s.players.player1.spirit = spirit;
    s.players.player1.hand = hand;
    s.players.player1.field = [wip(friendly, "f1")];
    s.players.player2.field = opponentEmpty ? [] : [wip(warriorOfFaction("Dwarf"), "e1")];
    return match;
  }

  const declareAttack = (root: HTMLElement): void => {
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();
  };

  it("prompts to choose an Attack card when a compatible one is in hand", () => {
    const atk = anAttackCard();
    const friendly = warriorOfFaction(atk.faction);
    const match = craftBattle(friendly, [atk], atk.cost + 1);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttack(root);
    const panel = root.querySelector(".play-match__choice");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Use an Attack card?");
    expect(panel!.textContent).toContain(atk.name);
  });

  it("resolves a normal attack when 'Regular attack' is chosen", () => {
    const atk = anAttackCard();
    const friendly = warriorOfFaction(atk.faction);
    const match = craftBattle(friendly, [atk], atk.cost + 1);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttack(root);
    buttonByText(root, ".play-match__choice-btn", "Regular attack (no card)")!.click();

    const events = match.state().events.map((e) => e.type);
    expect(events).toContain("warriorAttacked");
    // The Attack card was not consumed.
    expect(match.state().players.player1.hand.some((c) => c.id === atk.id)).toBe(true);
  });

  it("resolves through the Attack-card path when the card is chosen", () => {
    const atk = anAttackCard();
    const friendly = warriorOfFaction(atk.faction);
    const match = craftBattle(friendly, [atk], atk.cost + 1);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttack(root);
    buttonByText(root, ".play-match__choice-btn", `Use ${atk.name}`)!.click();

    const events = match.state().events.map((e) => e.type);
    expect(events).toContain("attackCardUsed");
    // The Attack card was spent to the Out Deck.
    expect(match.state().players.player1.hand.some((c) => c.id === atk.id)).toBe(false);
    expect(match.state().players.player1.outDeck.some((c) => c.id === atk.id)).toBe(true);
  });

  it("does not prompt for an off-faction Attack card", () => {
    const atk = anAttackCard();
    const otherFaction = ["Monk", "Dwarf", "Sonic", "Surfer", "Shaman"].find(
      (f) => f !== atk.faction,
    )!;
    const friendly = warriorOfFaction(otherFaction);
    const match = craftBattle(friendly, [atk], atk.cost + 5);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttack(root);
    // No choice prompt; the attack resolved straight away.
    expect(root.querySelector(".play-match__choice")).toBeNull();
    expect(match.state().players.player1.field[0]?.attacksRemaining).toBe(0);
  });

  it("does not offer the Attack card when Spirit is insufficient", () => {
    const atk = anAttackCard();
    const friendly = warriorOfFaction(atk.faction);
    const match = craftBattle(friendly, [atk], Math.max(0, atk.cost - 1));
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttack(root);
    expect(root.querySelector(".play-match__choice")).toBeNull();
  });

  it("does not prompt for Attack cards on a direct attack", () => {
    const atk = anAttackCard();
    const friendly = warriorOfFaction(atk.faction);
    const match = craftBattle(friendly, [atk], atk.cost + 1, /* opponentEmpty */ true);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__direct")!.click();
    expect(root.querySelector(".play-match__choice")).toBeNull();
    expect(match.state().events.map((e) => e.type)).toContain("directAttacked");
  });
});

describe("renderPlayableMatch — Lahkt Brand Family Products deck search", () => {
  const lahkt = (): Card => {
    const c = cards.find((card) => card.slug === "lahkt-brand-family-products");
    if (c === undefined) throw new Error("lahkt-brand-family-products missing from pool");
    return c;
  };
  const anItem = (): Card =>
    cards.find((c) => c.type === "Item" && c.slug !== "lahkt-brand-family-products")!;
  const aWeapon = (): Card => cards.find((c) => c.type === "Weapon")!;
  const aWarrior = (): Card => cards.find((c) => c.type === "Warrior")!;

  function craftSearch(deck: Card[]): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [lahkt()];
    s.players.player1.deck = deck;
    return match;
  }

  it("disables Lahkt when no eligible Item/Weapon is in the deck", () => {
    const match = craftSearch([aWarrior()]); // only a Warrior, not eligible
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const btn = buttonByText(root, ".play-match__card-btn", "No Item/Weapon in deck");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  it("offers Lahkt when at least one eligible Item or Weapon is in the deck", () => {
    const match = craftSearch([aWeapon()]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "Play")).toBeDefined();
  });

  it("shows valid deck Item/Weapon targets, excluding non-eligible cards", () => {
    const item = anItem();
    const warrior = aWarrior();
    const match = craftSearch([item, warrior]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    const panel = root.querySelector(".play-match__choice")!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain(item.name);
    // The Warrior in deck is not a valid target.
    expect(buttonByText(root, ".play-match__choice-btn", `Add ${warrior.name}`)).toBeUndefined();
  });

  it("adds the chosen card to hand, passing the correct target", () => {
    const weapon = aWeapon();
    const match = craftSearch([weapon]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__choice-btn", `Add ${weapon.name}`)!.click();

    const p1 = match.state().players.player1;
    expect(p1.hand.map((c) => c.id)).toContain(weapon.id);
    expect(p1.deck.map((c) => c.id)).not.toContain(weapon.id);
    // Lahkt itself was spent (no longer in hand).
    expect(p1.hand.some((c) => c.slug === "lahkt-brand-family-products")).toBe(false);
    expect(match.state().events.map((e) => e.type)).toContain("deckSearched");
  });

  it("does not spend Lahkt when the picker is canceled", () => {
    const weapon = aWeapon();
    const match = craftSearch([weapon]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__choice-cancel")!.click();
    expect(root.querySelector(".play-match__choice")).toBeNull();
    expect(match.state().players.player1.hand.some((c) => c.slug === "lahkt-brand-family-products")).toBe(true);
    expect(match.state().players.player1.deck.map((c) => c.id)).toContain(weapon.id);
  });

  it("lets deck target cards be inspected before selecting", () => {
    const weapon = aWeapon();
    const match = craftSearch([weapon]);
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    const look = root.querySelector<HTMLButtonElement>(
      ".play-match__choice .play-match__card-inspect",
    );
    expect(look).not.toBeNull();
    look!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect.mock.calls[0]![0].id).toBe(weapon.id);
  });
});

describe("renderPlayableMatch — SEARCH_DECK genericity (not just Lahkt)", () => {
  it("offers a deck-search picker for other SEARCH_DECK Items too", () => {
    // Greenskin Auction House: "Add 1 Weapon from your deck to your hand."
    const greenskin = cards.find((c) => c.slug === "greenskin-auction-house");
    if (greenskin === undefined) throw new Error("greenskin-auction-house missing");
    const weapon = cards.find((c) => c.type === "Weapon")!;
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [greenskin];
    s.players.player1.deck = [weapon, cards.find((c) => c.type === "Warrior")!];

    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__choice-btn", `Add ${weapon.name}`)!.click();
    expect(match.state().players.player1.hand.map((c) => c.id)).toContain(weapon.id);
  });
});

describe("renderPlayableMatch — A Thief's Pride hand steal", () => {
  const thief = (): Card => {
    const c = cards.find((card) => card.slug === "a-thiefs-pride");
    if (c === undefined) throw new Error("a-thiefs-pride missing from pool");
    return c;
  };
  const anItem = (): Card =>
    cards.find((c) => c.type === "Item" && c.slug !== "a-thiefs-pride")!;
  const aWarrior = (): Card => cards.find((c) => c.type === "Warrior")!;

  function craftSteal(opponentHand: Card[]): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [thief()];
    s.players.player2.hand = opponentHand;
    return match;
  }

  it("disables A Thief's Pride when the opponent has no Item", () => {
    const match = craftSteal([aWarrior()]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const btn = buttonByText(root, ".play-match__card-btn", "No Item in opponent's hand");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  it("shows the opponent's Item cards, excluding non-Items", () => {
    const item = anItem();
    const warrior = aWarrior();
    const match = craftSteal([item, warrior]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    const panel = root.querySelector(".play-match__choice")!;
    expect(panel.textContent).toContain(item.name);
    expect(buttonByText(root, ".play-match__choice-btn", `Take ${warrior.name}`)).toBeUndefined();
  });

  it("takes the chosen Item, passing the correct target", () => {
    const item = anItem();
    const match = craftSteal([item]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__choice-btn", `Take ${item.name}`)!.click();

    expect(match.state().players.player1.hand.map((c) => c.id)).toContain(item.id);
    expect(match.state().players.player2.hand.map((c) => c.id)).not.toContain(item.id);
    expect(match.state().players.player1.hand.some((c) => c.slug === "a-thiefs-pride")).toBe(false);
    expect(match.state().events.map((e) => e.type)).toContain("cardStolenFromHand");
  });

  it("does not spend A Thief's Pride when canceled", () => {
    const item = anItem();
    const match = craftSteal([item]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__choice-cancel")!.click();
    expect(root.querySelector(".play-match__choice")).toBeNull();
    expect(match.state().players.player1.hand.some((c) => c.slug === "a-thiefs-pride")).toBe(true);
    expect(match.state().players.player2.hand.map((c) => c.id)).toContain(item.id);
  });

  it("lets the opponent's Item be inspected before stealing", () => {
    const item = anItem();
    const match = craftSteal([item]);
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    root.querySelector<HTMLButtonElement>(
      ".play-match__choice .play-match__card-inspect",
    )!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect.mock.calls[0]![0].id).toBe(item.id);
  });
});

describe("battleLogLines (Feature C)", () => {
  // A minimal GameState carrying just what battleLogLines reads: card name
  // resolution from zones + the event log. Referenced cards live in player1's
  // Out Deck so name lookups resolve regardless of where they ended up.
  function stateWith(
    events: GameState["events"],
    cardsInPlay: Card[] = [],
  ): GameState {
    const seat = (outDeck: Card[]) => ({
      hand: [],
      deck: [],
      outDeck,
      field: [] as { card: Card }[],
    });
    return {
      players: { player1: seat(cardsInPlay), player2: seat([]) },
      events,
    } as unknown as GameState;
  }

  const titus = cards.find((c) => c.type === "Warrior")!;
  const kit = cards.find((c) => c.type === "Warrior" && c.id !== titus.id)!;

  it("uses readable card names and player/opponent labels for summons", () => {
    const lines = battleLogLines(
      stateWith(
        [
          { type: "warriorSummoned", player: "player1", cardId: titus.id, instanceId: "t1", cost: 1 },
          { type: "warriorSummoned", player: "player2", cardId: kit.id, instanceId: "k1", cost: 1 },
        ] as GameState["events"],
        [titus, kit],
      ),
    );
    expect(lines).toContain(`You summoned ${titus.name}.`);
    expect(lines).toContain(`Opponent summoned ${kit.name}.`);
  });

  it("renders attack, damage/destruction, and direct-attack lines from events", () => {
    const lines = battleLogLines(
      stateWith(
        [
          { type: "warriorSummoned", player: "player1", cardId: titus.id, instanceId: "t1", cost: 1 },
          { type: "warriorSummoned", player: "player2", cardId: kit.id, instanceId: "k1", cost: 1 },
          { type: "warriorAttacked", player: "player1", attackerInstanceId: "t1", defenderInstanceId: "k1", damage: 1200 },
          { type: "warriorDestroyed", player: "player2", instanceId: "k1", cardId: kit.id },
          { type: "directAttacked", player: "player2", attackerInstanceId: "x", livesRemaining: 2 },
        ] as GameState["events"],
        [titus, kit],
      ),
    );
    expect(lines).toContain(`${titus.name} attacked ${kit.name} for 1200 HEALTH.`);
    expect(lines).toContain(`${kit.name} was destroyed.`);
    expect(lines).toContain("Opponent landed a direct attack — your lives: 2.");
  });

  it("describes deck search, steal, revive, and item plays readably", () => {
    const item = cards.find((c) => c.type === "Item")!;
    const lines = battleLogLines(
      stateWith(
        [
          { type: "itemPlayed", player: "player2", cardId: item.id, cost: 1 },
          { type: "deckSearched", player: "player1", cardId: titus.id },
          { type: "cardStolenFromHand", player: "player1", fromPlayer: "player2", cardId: item.id },
          { type: "warriorRevived", player: "player1", cardId: kit.id, instanceId: "k2" },
        ] as GameState["events"],
        [titus, kit, item],
      ),
    );
    expect(lines).toContain(`Opponent played ${item.name}.`);
    expect(lines).toContain(`You searched their deck and added ${titus.name} to hand.`);
    expect(lines).toContain(`You took ${item.name} from the opponent's hand.`);
    expect(lines).toContain(`You revived ${kit.name}.`);
  });

  it("hides the opponent's drawn card but names the player's own", () => {
    const lines = battleLogLines(
      stateWith(
        [
          { type: "cardDrawn", player: "player1", cardId: titus.id },
          { type: "cardDrawn", player: "player2", cardId: kit.id },
        ] as GameState["events"],
        [titus, kit],
      ),
    );
    expect(lines).toContain(`You drew ${titus.name}.`);
    expect(lines).toContain("Opponent drew a card.");
    expect(lines).not.toContain(`Opponent drew ${kit.name}.`);
  });
});

describe("renderPlayableMatch — live battle log shows both sides", () => {
  it("logs the player's summon and the opponent's turn before control returns", () => {
    const match = newMatch(5);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    // End the turn so the AI opponent plays out; its actions must be logged.
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
    const logText = root.querySelector(".play-match__log-list")?.textContent ?? "";
    expect(logText).toContain("You summoned");
    if (!match.isOver()) {
      // After the opponent's turn the log carries at least one Opponent line.
      expect(logText).toContain("Opponent");
    }
    // Default scheduler queued a real playback timer; dispose so it can't fire
    // after this test (and the jsdom document) is torn down.
    root.dispose();
  });
});

describe("renderPlayableMatch — match playback & floating text (Feature B/C/D)", () => {
  // A scheduler the test drains manually so playback can be observed step by step.
  function manualScheduler() {
    let pending: (() => void) | null = null;
    const scheduler = (cb: () => void): void => {
      pending = cb;
    };
    const step = (): void => {
      const cb = pending;
      pending = null;
      cb?.();
    };
    const flush = (): void => {
      let guard = 0;
      while (pending && guard++ < 2000) step();
    };
    return { scheduler, step, flush, pending: () => pending !== null };
  }

  /** Battle scenario: P1 `attacker` vs P2 `defender`, no Attack cards in hand. */
  function craftAttack(attack: number, defenderHealth: number) {
    const atkCard = cards.find((c) => c.type === "Warrior")!;
    const defCard = cards.find((c) => c.type === "Warrior" && c.id !== atkCard.id)!;
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.phase = "battle";
    s.turn = 3;
    s.activePlayer = "player1";
    s.players.player1.hand = [];
    const a = wip(atkCard, "a1");
    a.currentAttack = attack;
    const d = wip(defCard, "e1");
    d.currentHealth = defenderHealth;
    s.players.player1.field = [a];
    s.players.player2.field = [d];
    return { match, defenderName: defCard.name };
  }

  it("shows a current-action callout and floating damage on a player attack", () => {
    const { match } = craftAttack(100, 5000); // non-lethal: defender tile remains
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();

    expect(root.querySelector(".play-match__callout")?.textContent).toContain("attacked");
    const float = root.querySelector(".play-match__float--damage");
    expect(float).not.toBeNull();
    expect(float!.textContent).toBe("-100 HEALTH");
    // Anchored to the defender's tile.
    expect(
      root.querySelector('[data-instance="e1"] .play-match__float--damage'),
    ).not.toBeNull();
  });

  it("does not return control instantly on the opponent's turn — it plays back", () => {
    const { scheduler, pending } = manualScheduler();
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();

    // Playback is in progress: banner shown, more steps scheduled.
    expect(root.querySelector(".play-match__playback-banner")).not.toBeNull();
    expect(pending()).toBe(true);
  });

  it("disables player actions during opponent playback", () => {
    const { scheduler } = manualScheduler();
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();

    // No enabled gameplay controls while the opponent acts.
    expect(root.querySelector<HTMLButtonElement>(".play-match__end")!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>(".play-match__enter")!.disabled).toBe(true);
    const enabledCardBtns = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".play-match__card-btn"),
    ).filter((b) => !b.disabled);
    expect(enabledCardBtns).toHaveLength(0);
  });

  it("plays the opponent's actions back, then returns control to the player", () => {
    const { scheduler, flush } = manualScheduler();
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
    flush();

    // Playback finished: banner gone and (game not over) control is back.
    expect(root.querySelector(".play-match__playback-banner")).toBeNull();
    if (!match.isOver()) {
      expect(root.querySelector<HTMLButtonElement>(".play-match__end")).not.toBeNull();
      // The full battle log records both the player's and opponent's actions.
      const log = root.querySelector(".play-match__log-list")?.textContent ?? "";
      expect(log).toContain("You summoned");
      expect(log).toContain("Opponent");
    }
  });

  it("surfaces opponent action callouts during playback", () => {
    const { scheduler, step, pending } = manualScheduler();
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();

    const callouts: string[] = [];
    let guard = 0;
    while (pending() && guard++ < 200) {
      const text = root.querySelector(".play-match__callout")?.textContent ?? "";
      if (text.trim().length > 0) callouts.push(text);
      step();
    }
    // At least one opponent-turn callout was shown during playback.
    expect(callouts.some((c) => c.includes("Opponent") || c.includes("turn"))).toBe(true);
  });
});

describe("renderPlayableMatch — reduced motion", () => {
  it("renders floating text without breaking under prefers-reduced-motion", () => {
    // Reduced motion is handled purely in CSS, so rendering must be unaffected.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const atkCard = cards.find((c) => c.type === "Warrior")!;
      const defCard = cards.find((c) => c.type === "Warrior" && c.id !== atkCard.id)!;
      const match = createPlayableMatch({
        faction: "Sonic",
        pool: cards,
        seed: 1,
        opponentFaction: "Dwarf",
      });
      const s = match.state();
      s.phase = "battle";
      s.turn = 3;
      s.activePlayer = "player1";
      s.players.player1.hand = [];
      const a = wip(atkCard, "a1");
      a.currentAttack = 100;
      const d = wip(defCard, "e1");
      d.currentHealth = 5000;
      s.players.player1.field = [a];
      s.players.player2.field = [d];

      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
      buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();
      expect(root.querySelector(".play-match__float--damage")?.textContent).toBe("-100 HEALTH");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("renderPlayableMatch — GILs Unit friendly-Warrior target", () => {
  const gils = (): Card => {
    const c = cards.find((card) => card.slug === "gils-unit");
    if (c === undefined) throw new Error("gils-unit missing from pool");
    return c;
  };
  const aWarrior = (): Card => cards.find((c) => c.type === "Warrior")!;

  function craftGils(field: WarriorInPlay[]): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [gils()];
    s.players.player1.field = field;
    return match;
  }

  it("disables GILs Unit when the player controls no Warrior", () => {
    const match = craftGils([]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const btn = buttonByText(root, ".play-match__card-btn", "No Warrior to target");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  it("offers GILs Unit when a friendly Warrior exists", () => {
    const match = craftGils([wip(aWarrior(), "w1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "Play")).toBeDefined();
  });

  it("shows a 'Use here' control on friendly Warriors after Play", () => {
    const match = craftGils([wip(aWarrior(), "w1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    const useHere = root.querySelector(
      '.play-match__field--mine [data-instance="w1"] .play-match__warrior-btn',
    );
    expect(useHere?.textContent).toBe("Use here");
  });

  it("resolves GILs Unit on the chosen Warrior, passing targetInstanceId", () => {
    const match = craftGils([wip(aWarrior(), "w1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Use here")!.click();

    const p1 = match.state().players.player1;
    // The Warrior left the field for the out-of-play zone; GILs Unit was spent.
    expect(p1.field.some((w) => w.instanceId === "w1")).toBe(false);
    expect(p1.outOfPlay.some((o) => o.warrior.instanceId === "w1")).toBe(true);
    expect(p1.hand.some((c) => c.slug === "gils-unit")).toBe(false);
    const events = match.state().events.map((e) => e.type);
    expect(events).toContain("warriorSentOutOfPlay");
    // It must NOT have silently failed.
    expect(events).not.toContain("effectNotImplemented");
  });

  it("does not spend GILs Unit when the target picker is canceled", () => {
    const match = craftGils([wip(aWarrior(), "w1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    // Toggle off (cancel) by clicking the active "Pick a Warrior…" button.
    buttonByText(root, ".play-match__card-btn", "Pick a Warrior…")!.click();
    expect(root.querySelector('[data-instance="w1"] .play-match__warrior-btn')).toBeNull();
    const p1 = match.state().players.player1;
    expect(p1.hand.some((c) => c.slug === "gils-unit")).toBe(true);
    expect(p1.field.some((w) => w.instanceId === "w1")).toBe(true);
  });
});

describe("renderPlayableMatch — Batch A friendly-target Items", () => {
  const bySlug = (slug: string): Card => {
    const c = cards.find((card) => card.slug === slug);
    if (c === undefined) throw new Error(`${slug} missing from pool`);
    return c;
  };
  const monkWarrior = (): Card => cards.find((c) => c.type === "Warrior" && c.faction === "Monk")!;
  const nonMonkWarrior = (): Card =>
    cards.find((c) => c.type === "Warrior" && c.faction !== "Monk" && c.faction !== "Neutral")!;

  function craftItem(itemSlug: string, field: WarriorInPlay[]) {
    const match = createPlayableMatch({
      faction: "Monk",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [bySlug(itemSlug)];
    s.players.player1.field = field;
    return match;
  }

  it("resolves Gunder Love (heal) on the chosen friendly Warrior", () => {
    const match = craftItem("gunder-love", [wip(monkWarrior(), "w1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Use here")!.click();
    const p1 = match.state().players.player1;
    expect(p1.hand.some((c) => c.slug === "gunder-love")).toBe(false);
    expect(match.state().events.map((e) => e.type)).not.toContain("effectNotImplemented");
  });

  it("offers Choir of Pyrois only on Monk Warriors", () => {
    const match = craftItem("choir-of-pyrois", [
      wip(monkWarrior(), "monk1"),
      wip(nonMonkWarrior(), "other1"),
    ]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    expect(
      root.querySelector('[data-instance="monk1"] .play-match__warrior-btn')?.textContent,
    ).toBe("Use here");
    expect(root.querySelector('[data-instance="other1"] .play-match__warrior-btn')).toBeNull();
  });

  it("disables Choir of Pyrois when no Monk Warrior is in play", () => {
    const match = craftItem("choir-of-pyrois", [wip(nonMonkWarrior(), "other1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "No Warrior to target")?.disabled).toBe(true);
  });

  it("disables High Tea with fewer than 2 Warriors, offers it with 2", () => {
    const one = craftItem("high-tea", [wip(monkWarrior(), "w1")]);
    const rootOne = renderPlayableMatch(one, { onComplete: noop, onQuit: noop });
    expect(buttonByText(rootOne, ".play-match__card-btn", "No Warrior to target")?.disabled).toBe(true);

    const two = craftItem("high-tea", [wip(monkWarrior(), "w1"), wip(monkWarrior(), "w2")]);
    const rootTwo = renderPlayableMatch(two, { onComplete: noop, onQuit: noop });
    expect(buttonByText(rootTwo, ".play-match__card-btn", "Play")).toBeDefined();
  });
});

describe("renderPlayableMatch — Batch B enemy-target Items", () => {
  const bySlug = (slug: string): Card => {
    const c = cards.find((card) => card.slug === slug);
    if (c === undefined) throw new Error(`${slug} missing from pool`);
    return c;
  };
  const aWarrior = (): Card => cards.find((c) => c.type === "Warrior")!;

  function craftEnemyItem(
    itemSlug: string,
    enemyField: WarriorInPlay[],
    myField: WarriorInPlay[] = [],
  ) {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.players.player1.spirit = 5;
    s.players.player1.hand = [bySlug(itemSlug)];
    s.players.player1.field = myField;
    s.players.player2.field = enemyField;
    return match;
  }

  it("disables Coerced Loyalty when the opponent has no Warrior", () => {
    const match = craftEnemyItem("coerced-loyalty", []);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "No enemy Warrior to target")?.disabled).toBe(true);
  });

  it("shows a 'Target' control on enemy Warriors after Play (Coerced Loyalty)", () => {
    const match = craftEnemyItem("coerced-loyalty", [wip(aWarrior(), "e1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    expect(
      root.querySelector('.play-match__field--theirs [data-instance="e1"] .play-match__warrior-btn')?.textContent,
    ).toBe("Target");
    // No friendly "Use here" appears for an enemy-target item.
    expect(buttonByText(root, ".play-match__warrior-btn", "Use here")).toBeUndefined();
  });

  it("resolves Coerced Loyalty on the chosen enemy Warrior", () => {
    const match = craftEnemyItem("coerced-loyalty", [wip(aWarrior(), "e1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Target")!.click();

    const s = match.state();
    expect(s.players.player1.field.some((w) => w.instanceId === "e1")).toBe(true); // stolen to my side
    expect(s.players.player2.field.some((w) => w.instanceId === "e1")).toBe(false);
    expect(s.players.player1.hand.some((c) => c.slug === "coerced-loyalty")).toBe(false);
    const events = s.events.map((e) => e.type);
    expect(events).toContain("warriorControlStolen");
    expect(events).not.toContain("effectNotImplemented");
  });

  it("resolves Primetime Interview on the chosen enemy Warrior", () => {
    const match = craftEnemyItem("primetime-interview", [wip(aWarrior(), "e1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Target")!.click();
    const s = match.state();
    expect(s.players.player1.hand.some((c) => c.slug === "primetime-interview")).toBe(false);
    expect(s.events.map((e) => e.type)).not.toContain("effectNotImplemented");
  });

  it("does not spend the enemy-target Item when canceled", () => {
    const match = craftEnemyItem("coerced-loyalty", [wip(aWarrior(), "e1")]);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Play")!.click();
    buttonByText(root, ".play-match__card-btn", "Pick an enemy…")!.click(); // toggle off
    expect(root.querySelector('[data-instance="e1"] .play-match__warrior-btn')).toBeNull();
    expect(match.state().players.player1.hand.some((c) => c.slug === "coerced-loyalty")).toBe(true);
  });

  it("disables Coerced Loyalty when your field is full (no room)", () => {
    const full = Array.from({ length: 5 }, (_, i) => wip(aWarrior(), `m${i}`));
    const match = craftEnemyItem("coerced-loyalty", [wip(aWarrior(), "e1")], full);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(buttonByText(root, ".play-match__card-btn", "No enemy Warrior to target")?.disabled).toBe(true);
  });
});

describe("renderPlayableMatch — attack-time secondary target (Gylippus/Scythe/Moirai)", () => {
  const bySlug = (slug: string): Card => {
    const c = cards.find((card) => card.slug === slug);
    if (c === undefined) throw new Error(`no card with slug ${slug}`);
    return c;
  };
  const warriorOfFaction = (faction: string): Card => {
    const c = cards.find((card) => card.type === "Warrior" && card.faction === faction);
    if (c === undefined) throw new Error(`no Warrior for faction ${faction}`);
    return c;
  };
  /** Two distinct Warrior cards (so their names differ in the picker). */
  const twoWarriors = (): [Card, Card] => {
    const ws = cards.filter((c) => c.type === "Warrior");
    if (ws.length < 2) throw new Error("need 2 distinct Warriors");
    return [ws[0]!, ws[1]!];
  };

  function craft(opts: {
    attacker: WarriorInPlay;
    allies?: WarriorInPlay[];
    enemies: WarriorInPlay[];
    hand?: Card[];
    spirit?: number;
  }): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Monk",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.phase = "battle";
    s.turn = 3; // attacks allowed
    s.activePlayer = "player1";
    s.players.player1.spirit = opts.spirit ?? 5;
    s.players.player1.hand = opts.hand ?? [];
    s.players.player1.field = [opts.attacker, ...(opts.allies ?? [])];
    s.players.player2.field = opts.enemies;
    return match;
  }

  // Select the first friendly attacker, then attack the first enemy (the defender).
  const declareAttackOnFirst = (root: HTMLElement): void => {
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();
  };

  const withWeapon = (card: Card, id: string, weapon: Card): WarriorInPlay => {
    const w = wip(card, id);
    w.attachedWeapon = weapon;
    return w;
  };

  it("offers a second enemy target after choosing Gylippus, excluding the defender", () => {
    const gylippus = bySlug("gylippus");
    const [eA, eB] = twoWarriors();
    const match = craft({
      attacker: wip(warriorOfFaction("Monk"), "a1"),
      enemies: [wip(eA, "e1"), wip(eB, "e2")],
      hand: [gylippus],
      spirit: gylippus.cost + 1,
    });
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root); // attacks e1 (the defender)
    buttonByText(root, ".play-match__choice-btn", `Use ${gylippus.name}`)!.click();

    const panel = root.querySelector(".play-match__choice");
    expect(panel!.textContent).toContain("deal extra damage to a second enemy");
    // Only the non-defender enemy (e2 / eB) is offered.
    expect(buttonByText(root, ".play-match__choice-btn", `Target ${eB.name}`)).toBeDefined();
    expect(buttonByText(root, ".play-match__choice-btn", `Target ${eA.name}`)).toBeUndefined();
  });

  it("resolves Gylippus against the chosen second enemy (effectTargetInstanceId)", () => {
    const gylippus = bySlug("gylippus");
    const [eA, eB] = twoWarriors();
    const match = craft({
      attacker: wip(warriorOfFaction("Monk"), "a1"),
      enemies: [wip(eA, "e1"), wip(eB, "e2")],
      hand: [gylippus],
      spirit: gylippus.cost + 1,
    });
    const before = match.state().players.player2.field.find((w) => w.instanceId === "e2")!
      .currentHealth;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    buttonByText(root, ".play-match__choice-btn", `Use ${gylippus.name}`)!.click();
    buttonByText(root, ".play-match__choice-btn", `Target ${eB.name}`)!.click();

    const after = match.state().players.player2.field.find((w) => w.instanceId === "e2")
      ?.currentHealth;
    expect(after).toBe(before - 1000); // secondary 1000 landed
    expect(match.state().players.player1.outDeck.some((c) => c.id === gylippus.id)).toBe(true);
  });

  it("skips the secondary hit (Gylippus still resolves) and leaves the other enemy untouched", () => {
    const gylippus = bySlug("gylippus");
    const [eA, eB] = twoWarriors();
    const match = craft({
      attacker: wip(warriorOfFaction("Monk"), "a1"),
      enemies: [wip(eA, "e1"), wip(eB, "e2")],
      hand: [gylippus],
      spirit: gylippus.cost + 1,
    });
    const before = match.state().players.player2.field.find((w) => w.instanceId === "e2")!
      .currentHealth;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    buttonByText(root, ".play-match__choice-btn", `Use ${gylippus.name}`)!.click();
    buttonByText(root, ".play-match__choice-btn", "Skip (attack without it)")!.click();

    const after = match.state().players.player2.field.find((w) => w.instanceId === "e2")
      ?.currentHealth;
    expect(after).toBe(before); // untouched
    expect(match.state().players.player1.outDeck.some((c) => c.id === gylippus.id)).toBe(true);
  });

  it("cancel/back does not resolve the attack or spend the Attack card", () => {
    const gylippus = bySlug("gylippus");
    const [eA, eB] = twoWarriors();
    const match = craft({
      attacker: wip(warriorOfFaction("Monk"), "a1"),
      enemies: [wip(eA, "e1"), wip(eB, "e2")],
      hand: [gylippus],
      spirit: gylippus.cost + 1,
    });
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    buttonByText(root, ".play-match__choice-btn", `Use ${gylippus.name}`)!.click();
    buttonByText(root, ".play-match__choice-cancel", "Cancel")!.click();

    const s = match.state();
    expect(s.events.map((e) => e.type)).not.toContain("attackCardUsed");
    expect(s.events.map((e) => e.type)).not.toContain("warriorAttacked");
    expect(s.players.player1.hand.some((c) => c.id === gylippus.id)).toBe(true);
    expect(s.players.player1.field.find((w) => w.instanceId === "a1")?.attacksRemaining).toBe(1);
    expect(root.querySelector(".play-match__choice")).toBeNull();
  });

  it("Scythe Cycle offers no splash picker when the opponent has a single Warrior", () => {
    const scythe = bySlug("scythe-cycle");
    const [eA] = twoWarriors();
    const match = craft({
      attacker: withWeapon(warriorOfFaction("Dwarf"), "a1", scythe),
      enemies: [wip(eA, "e1")],
      hand: [],
    });
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    // No secondary picker; the attack resolved straight away.
    expect(root.querySelector(".play-match__choice")).toBeNull();
    expect(match.state().events.map((e) => e.type)).toContain("warriorAttacked");
  });

  it("Scythe Cycle splashes the chosen enemy (effectTargetInstanceId)", () => {
    const scythe = bySlug("scythe-cycle");
    const [eA, eB] = twoWarriors();
    const match = craft({
      attacker: withWeapon(warriorOfFaction("Dwarf"), "a1", scythe),
      enemies: [wip(eA, "e1"), wip(eB, "e2")],
      hand: [],
    });
    const before = match.state().players.player2.field.find((w) => w.instanceId === "e2")!
      .currentHealth;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    const panel = root.querySelector(".play-match__choice");
    expect(panel!.textContent).toContain("Scythe Cycle");
    buttonByText(root, ".play-match__choice-btn", `Target ${eB.name}`)!.click();

    const after = match.state().players.player2.field.find((w) => w.instanceId === "e2")
      ?.currentHealth;
    expect(after).toBe(before - 500); // 500 splash landed
  });

  it("Moirai offers another friendly Warrior and grants it an extra attack", () => {
    const moirai = bySlug("moirai");
    const [eA] = twoWarriors();
    const ally = warriorOfFaction("Surfer");
    const match = craft({
      attacker: withWeapon(warriorOfFaction("Dwarf"), "a1", moirai),
      allies: [wip(ally, "al1")],
      enemies: [wip(eA, "e1")],
      hand: [],
    });
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    declareAttackOnFirst(root);
    const panel = root.querySelector(".play-match__choice");
    expect(panel!.textContent).toContain("Moirai");
    buttonByText(root, ".play-match__choice-btn", `Target ${ally.name}`)!.click();

    expect(match.state().players.player1.field.find((w) => w.instanceId === "al1")
      ?.attacksRemaining).toBe(2); // 1 + the Moirai grant
  });
});

describe("renderPlayableMatch — battlefield UX polish (Feature A–F)", () => {
  it("renders labelled opponent, player, and hand zones", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const labels = Array.from(root.querySelectorAll(".play-match__zone-label")).map(
      (e) => e.textContent,
    );
    expect(labels).toContain("Opponent");
    expect(labels).toContain("You");
    expect(labels).toContain("Your hand");
    expect(root.querySelector(".play-match__zone--opponent")).not.toBeNull();
    expect(root.querySelector(".play-match__zone--mine")).not.toBeNull();
    expect(root.querySelector(".play-match__zone--hand")).not.toBeNull();
  });

  it("shows deck, hand, and Out Deck counts for both players", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelectorAll(".play-match__stat--deck").length).toBe(2);
    expect(root.querySelectorAll(".play-match__stat--hand").length).toBe(2);
    expect(root.querySelectorAll(".play-match__stat--out").length).toBe(2);
    const s = match.state();
    const mine = root.querySelector(".play-match__zone--mine")!;
    expect(mine.querySelector(".play-match__stat--deck")!.textContent).toContain(
      String(s.players.player1.deck.length),
    );
    expect(mine.querySelector(".play-match__stat--hand")!.textContent).toContain(
      String(s.players.player1.hand.length),
    );
  });

  it("does not reveal opponent hand card names (count only)", () => {
    const match = matchWithOpponentWarrior(5);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const oppZone = root.querySelector(".play-match__zone--opponent")!;
    // The opponent zone shows a hand count chip but no hand card tiles.
    expect(oppZone.querySelector(".play-match__stat--hand")).not.toBeNull();
    expect(oppZone.querySelectorAll(".play-match__card").length).toBe(0);
  });

  it("keeps live cards inspectable and shows a full card-art image", () => {
    const onInspect = vi.fn();
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const card = root.querySelector<HTMLElement>(".play-match__card")!;
    // The full card art is shown on the card face (Feature A).
    expect(card.querySelector("img.play-match__art")).not.toBeNull();
    // The dedicated inspect button still opens the detail modal.
    card.querySelector<HTMLButtonElement>(".play-match__card-inspect")!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("exposes a disabled action's reason as a tooltip and aria-label", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    root.querySelector<HTMLButtonElement>(".play-match__enter")!.click();
    const blocked = buttonByText(root, ".play-match__card-btn", "Not during Battle")!;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe("Not during Battle");
    expect(blocked.getAttribute("aria-label")).toContain("Not during Battle");
  });

  it("explains the one-summon-per-turn limit with a tooltip", () => {
    const match = newMatch();
    match.state().players.player1.spirit = 99;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    const limited = buttonByText(root, ".play-match__card-btn", "One summon per turn")!;
    expect(limited.disabled).toBe(true);
    expect(limited.title).toBe("One summon per turn");
  });

  it("explains insufficient Spirit on an unaffordable card", () => {
    const match = newMatch();
    match.state().players.player1.spirit = 0;
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const broke = buttonByText(root, ".play-match__card-btn", "Not enough Spirit")!;
    expect(broke.disabled).toBe(true);
    expect(broke.title).toBe("Not enough Spirit");
    expect(broke.getAttribute("aria-label")).toContain("Not enough Spirit");
  });

  it("shows a prominent phase banner reflecting your move and phase", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const banner = root.querySelector(".play-match__phase")!;
    expect(banner.textContent).toContain("Your move");
    expect(banner.textContent).toContain("Main phase");
    expect(banner.classList.contains("play-match__phase--you")).toBe(true);
  });

  it("groups the battle log by turn and tints player rows", () => {
    const match = newMatch(5);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    expect(root.querySelector(".play-match__log-turn")).not.toBeNull();
    expect(root.querySelector(".play-match__log-entry--you")).not.toBeNull();
  });
});

describe("renderPlayableMatch — playback timer cleanup (CI teardown safety)", () => {
  it("cancels the pending real playback timer on dispose (default scheduler)", () => {
    vi.useFakeTimers();
    try {
      const match = newMatch(5);
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      buttonByText(root, ".play-match__card-btn", "Summon")!.click();
      root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
      // Opponent playback queued a real setTimeout.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      root.dispose();
      // dispose() cleared it — nothing can fire after teardown.
      expect(vi.getTimerCount()).toBe(0);
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a queued playback step is a safe no-op after dispose (no DOM access)", () => {
    let queued: (() => void) | null = null;
    const scheduler = (cb: () => void): void => {
      queued = cb;
    };
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
    expect(queued).not.toBeNull(); // a playback step is queued

    root.dispose();
    const snapshot = root.innerHTML;
    // Firing the stale callback must not re-render (it would otherwise paint()).
    expect(() => queued!()).not.toThrow();
    expect(root.innerHTML).toBe(snapshot);
  });

  it("completes opponent playback normally and leaves no dangling timer", () => {
    vi.useFakeTimers();
    try {
      const match = newMatch(5);
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      buttonByText(root, ".play-match__card-btn", "Summon")!.click();
      root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
      vi.runAllTimers(); // drain the whole opponent turn
      expect(root.querySelector(".play-match__playback-banner")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      if (!match.isOver()) {
        // Control returned to the player after playback.
        expect(root.querySelector<HTMLButtonElement>(".play-match__end")).not.toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose is idempotent", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(() => {
      root.dispose();
      root.dispose();
    }).not.toThrow();
  });
});

describe("renderPlayableMatch — battlefield card visuals (milestone)", () => {
  it("renders hand cards as actual card images with a source", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const handCards = root.querySelectorAll(".play-match__card");
    expect(handCards.length).toBeGreaterThan(0);
    // Every hand card carries a real card-art image with a resolved src.
    for (const card of handCards) {
      const art = card.querySelector<HTMLImageElement>(".play-match__art");
      expect(art).not.toBeNull();
      expect(art!.getAttribute("src")).toBeTruthy();
    }
  });

  it("renders field Warriors as card-like cards with an image", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    const warrior = root.querySelector(".play-match__field--mine .play-match__warrior");
    expect(warrior).not.toBeNull();
    const art = warrior!.querySelector<HTMLImageElement>(".play-match__art");
    expect(art).not.toBeNull();
    expect(art!.getAttribute("src")).toBeTruthy();
    // Card-like: it shows the name and current ATK/HEALTH stats.
    expect(warrior!.querySelector(".play-match__warrior-name")?.textContent).toBeTruthy();
    expect(warrior!.querySelector(".play-match__warrior-stats")?.textContent).toBeTruthy();
  });

  it("falls back to full-size art, then the missing-art placeholder", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const art = root.querySelector<HTMLImageElement>(".play-match__card .play-match__art")!;
    expect(art.classList.contains("play-match__art--missing")).toBe(false);
    // The display src is the optimized thumbnail.
    expect(art.getAttribute("src")).toMatch(/optimized\/.+\.webp$/);
    // First failure (thumbnail missing) falls back to the full-size PNG.
    art.dispatchEvent(new Event("error"));
    expect(art.getAttribute("src")).toMatch(/\.png$/);
    expect(art.classList.contains("play-match__art--missing")).toBe(false);
    // Second failure (full-size also missing) drops the icon for the placeholder.
    art.dispatchEvent(new Event("error"));
    expect(art.classList.contains("play-match__art--missing")).toBe(true);
    expect(art.hasAttribute("src")).toBe(false);
  });

  it("keeps cards inspectable via their card image (detail modal)", () => {
    const match = newMatch();
    const onInspect = vi.fn();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    // Tapping the card face (which contains the art) opens the detail modal.
    root.querySelector<HTMLButtonElement>(".play-match__card-inspect")!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
  });
});

describe("live match battlefield layout (CSS, milestone)", () => {
  // The layout is driven entirely by CSS (jsdom computes no layout), so we assert
  // the stylesheet carries the wide-desktop battlefield + responsive intent.
  // jsdom makes import.meta.url an http URL, so resolve from the run cwd instead.
  const css = ((): string => {
    for (const p of ["apps/web/src/styles.css", "src/styles.css"]) {
      try {
        return readFileSync(resolve(process.cwd(), p), "utf8");
      } catch {
        /* try next candidate */
      }
    }
    throw new Error("styles.css not found from cwd " + process.cwd());
  })();

  it("widens the desktop battlefield beyond the narrow account column", () => {
    // The board breaks out of .account's min(640px) form width.
    expect(css).toMatch(/\.play-match\s*\{[^}]*width:\s*min\(1400px/);
  });

  it("scales cards up on desktop so the battlefield uses the width", () => {
    expect(css).toMatch(/@media \(min-width: 1024px\)/);
    // Cards grow at desktop widths (card-size variable is bumped).
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*--card-w:\s*8\.5rem/);
  });

  it("still stacks into a single column on mobile with smaller cards", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*--card-w:/);
  });

  it("shows cards as portrait card art (3 / 4), not landscape thumbnails", () => {
    expect(css).toMatch(/\.play-match__art\s*\{[^}]*aspect-ratio:\s*3 \/ 4/);
  });
});

describe("renderPlayableMatch — cinematic pass (Feature B–F)", () => {
  /** Battle scenario: P1 `attacker` vs P2 `defender`, no Attack cards in hand. */
  function craftAttack(attack: number, defenderHealth: number) {
    const atkCard = cards.find((c) => c.type === "Warrior")!;
    const defCard = cards.find((c) => c.type === "Warrior" && c.id !== atkCard.id)!;
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed: 1,
      opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.phase = "battle";
    s.turn = 3;
    s.activePlayer = "player1";
    s.players.player1.hand = [];
    const a = wip(atkCard, "a1");
    a.currentAttack = attack;
    const d = wip(defCard, "e1");
    d.currentHealth = defenderHealth;
    s.players.player1.field = [a];
    s.players.player2.field = [d];
    return match;
  }

  function collectAnim(root: HTMLElement): MatchAnimDetail["kind"][] {
    const kinds: MatchAnimDetail["kind"][] = [];
    root.addEventListener(MATCH_ANIM_EVENT, (e) => {
      kinds.push((e as CustomEvent<MatchAnimDetail>).detail.kind);
    });
    return kinds;
  }

  it("Feature B: selecting a Warrior shows its actions in the panel", () => {
    const match = craftAttack(100, 5000);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // Select the attacker tile (its face), not the inspect button.
    root
      .querySelector<HTMLElement>('[data-instance="a1"] .play-match__warrior-face')!
      .click();
    const panel = root.querySelector(".play-match__selected");
    expect(panel).not.toBeNull();
    expect(
      buttonByText(root, ".play-match__selected-actions .play-match__warrior-btn", "Choose to attack"),
    ).toBeDefined();
  });

  it("Feature B: the panel shows a disabled action's reason", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // Enter Battle so a Warrior in hand becomes unplayable with a clear reason.
    root.querySelector<HTMLButtonElement>(".play-match__enter")!.click();
    const blocked = buttonByText(root, ".play-match__card-btn", "Not during Battle")!;
    const card = blocked.closest<HTMLElement>(".play-match__card")!;
    card.querySelector<HTMLElement>(".play-match__card-face")!.click();
    const panel = root.querySelector(".play-match__selected")!;
    const reason = buttonByText(
      root,
      ".play-match__selected-actions .play-match__card-btn",
      "Not during Battle",
    );
    expect(panel.contains(reason ?? null)).toBe(true);
    expect(reason!.disabled).toBe(true);
  });

  it("Feature D: valid attack targets are highlighted during target selection", () => {
    const match = craftAttack(100, 5000);
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // No target highlight before choosing an attacker.
    expect(root.querySelector(".play-match__field--theirs .play-match__warrior--target")).toBeNull();
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    // The enemy Warrior is now highlighted as a valid target.
    expect(
      root.querySelector('.play-match__field--theirs [data-instance="e1"].play-match__warrior--target'),
    ).not.toBeNull();
  });

  it("Feature C/F: a summon queues a 'summon' animation event", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const kinds = collectAnim(root);
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    expect(kinds).toContain("summon");
  });

  it("Feature C/F: a lethal attack queues 'attack' and 'destroy' events", () => {
    const match = craftAttack(9000, 100); // lethal
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const kinds = collectAnim(root);
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();
    expect(kinds).toContain("attack");
    expect(kinds).toContain("destroy");
  });

  it("Feature E/F: opponent playback queues a 'draw' animation event", () => {
    let queued: (() => void) | null = null;
    const scheduler = (cb: () => void): void => {
      queued = cb;
    };
    const flush = (): void => {
      let guard = 0;
      while (queued && guard++ < 2000) {
        const cb = queued;
        queued = null;
        cb();
      }
    };
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    const kinds = collectAnim(root);
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
    flush();
    // The opponent's turn (drawn during playback) emits a draw moment.
    expect(kinds).toContain("draw");
    root.dispose();
  });
});

describe("renderPlayableMatch — mobile stability on long matches", () => {
  const agent = smartAgent();

  /** Drives a real match with the smart agent until `stop` is met or it ends. */
  function drive(
    seed: number,
    stop: (m: ReturnType<typeof createPlayableMatch>) => boolean,
  ): ReturnType<typeof createPlayableMatch> {
    const match = createPlayableMatch({
      faction: "Sonic",
      pool: cards,
      seed,
      opponentFaction: "Dwarf",
    });
    let guard = 0;
    while (!match.isOver() && !stop(match) && guard < 600) {
      const legal = match.legalActions();
      if (legal.length === 0) break;
      match.apply(agent(match.state(), legal));
      guard++;
    }
    return match;
  }

  it("caps the rendered battle log so the DOM stays bounded (root cause fix)", () => {
    // Drive a mid-game state with far more events than the render cap.
    const match = drive(11, (m) => m.state().events.length > MAX_RENDERED_LOG_ENTRIES * 2);
    expect(match.isOver()).toBe(false);
    expect(match.state().events.length).toBeGreaterThan(MAX_RENDERED_LOG_ENTRIES);

    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const rows = root.querySelectorAll(
      ".play-match__log-entry, .play-match__log-turn",
    ).length;
    expect(rows).toBeLessThanOrEqual(MAX_RENDERED_LOG_ENTRIES);
    // The truncation note tells the player history was capped (not lost).
    expect(root.querySelector(".play-match__log-truncated")).not.toBeNull();
    // The full log is still computed for anyone who needs it.
    expect(battleLogLines(match.state()).length).toBeGreaterThan(MAX_RENDERED_LOG_ENTRIES);
  });

  it("runs a 30+ turn match to completion without throwing", () => {
    expect(() => {
      const match = drive(11, () => false); // play to the end
      expect(match.state().turn).toBeGreaterThanOrEqual(20);
    }).not.toThrow();
  });

  it("does not accumulate timers or playback queues across many opponent turns", () => {
    vi.useFakeTimers();
    try {
      const match = createPlayableMatch({
        faction: "Sonic",
        pool: cards,
        seed: 5,
        opponentFaction: "Dwarf",
      });
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      for (let turn = 0; turn < 12 && !match.isOver(); turn++) {
        const summon = buttonByText(root, ".play-match__card-btn", "Summon");
        if (summon && !summon.disabled) summon.click();
        const end = root.querySelector<HTMLButtonElement>(".play-match__end");
        if (!end || end.disabled) break;
        end.click();
        vi.runAllTimers(); // drain the whole opponent reply
        // No timers ever accumulate across opponent turns (the core leak check).
        expect(vi.getTimerCount()).toBe(0);
        // Once playback completes (and the match is still going), nothing pending.
        if (!match.isOver()) {
          expect(root.querySelector(".play-match__playback-banner")).toBeNull();
        }
      }
      root.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears floating text + playback state once an opponent turn finishes", () => {
    vi.useFakeTimers();
    try {
      const match = createPlayableMatch({
        faction: "Sonic",
        pool: cards,
        seed: 5,
        opponentFaction: "Dwarf",
      });
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      const summon = buttonByText(root, ".play-match__card-btn", "Summon");
      if (summon && !summon.disabled) summon.click();
      root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
      vi.runAllTimers();
      if (!match.isOver()) {
        // No leftover floating-text nodes or playback banner after playback ends.
        expect(root.querySelectorAll(".play-match__float").length).toBe(0);
        expect(root.querySelector(".play-match__playback-banner")).toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders fully under reduced motion (mobile-safe) and still acts", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const match = createPlayableMatch({
        faction: "Sonic",
        pool: cards,
        seed: 1,
        opponentFaction: "Dwarf",
      });
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      // Board + log still render, and a core action still performs.
      expect(root.querySelectorAll(".play-match__card").length).toBeGreaterThan(0);
      expect(root.querySelector(".play-match__log-list")).not.toBeNull();
      buttonByText(root, ".play-match__card-btn", "Summon")!.click();
      expect(match.state().players.player1.field.length).toBe(1);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("renderPlayableMatch — mobile forced-refresh pressure (Part D)", () => {
  it("reuses the same card-art <img> node across repaints (no recreation)", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // Grab a hand card's art node, then trigger a repaint by selecting a card.
    const firstArt = root.querySelector<HTMLImageElement>(
      ".play-match__card .play-match__art",
    );
    expect(firstArt).not.toBeNull();
    const src = firstArt!.getAttribute("src");
    // Force several repaints (select toggles re-render the board in place).
    const face = root.querySelector<HTMLElement>(".play-match__card-face")!;
    face.click();
    face.click();
    face.click();
    const afterArt = root.querySelector<HTMLImageElement>(
      ".play-match__card .play-match__art",
    );
    // The cached node is moved into the new frame — same element identity + src.
    expect(afterArt).toBe(firstArt);
    expect(afterArt!.getAttribute("src")).toBe(src);
  });

  it("dispose() cancels animations and clears transient nodes", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // Inject a fake beam to prove dispose sweeps transient overlay nodes.
    const beam = document.createElement("div");
    beam.className = "play-match__beam";
    root.append(beam);
    expect(root.querySelector(".play-match__beam")).not.toBeNull();
    root.dispose();
    expect(root.querySelector(".play-match__beam")).toBeNull();
    // Idempotent + safe after teardown.
    expect(() => root.dispose()).not.toThrow();
  });

  it("renders in low-power mode (coarse pointer) and still plays", () => {
    window.localStorage.setItem("euphoriaLowPower", "1");
    try {
      const match = newMatch();
      const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
      expect(root.querySelectorAll(".play-match__card").length).toBeGreaterThan(0);
      // A core action still performs in low-power mode.
      buttonByText(root, ".play-match__card-btn", "Summon")!.click();
      expect(match.state().players.player1.field.length).toBe(1);
    } finally {
      window.localStorage.removeItem("euphoriaLowPower");
    }
  });
});

describe("renderPlayableMatch — stability isolation toggles (Feature B/C/F)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("no-art mode renders the live match without <img> card art", () => {
    window.localStorage.setItem("euphoriaNoArt", "1");
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    // Cards still render (placeholders), but no heavy <img> art nodes.
    expect(root.querySelectorAll(".play-match__card").length).toBeGreaterThan(0);
    expect(root.querySelectorAll("img.play-match__art").length).toBe(0);
    expect(root.querySelectorAll(".play-match__art--placeholder").length)
      .toBeGreaterThan(0);
    // Still playable.
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    expect(match.state().players.player1.field.length).toBe(1);
  });

  it("no-anim mode tags the board so CSS motion is disabled", () => {
    window.localStorage.setItem("euphoriaNoAnim", "1");
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.classList.contains("play-match--no-anim")).toBe(true);
  });

  it("no-anim mode still emits anim events (state changes preserved)", () => {
    window.localStorage.setItem("euphoriaNoAnim", "1");
    const atkCard = cards.find((c) => c.type === "Warrior")!;
    const defCard = cards.find((c) => c.type === "Warrior" && c.id !== atkCard.id)!;
    const match = createPlayableMatch({
      faction: "Sonic", pool: cards, seed: 1, opponentFaction: "Dwarf",
    });
    const s = match.state();
    s.phase = "battle";
    s.turn = 3;
    s.activePlayer = "player1";
    s.players.player1.hand = [];
    const a = wip(atkCard, "a1");
    a.currentAttack = 9000;
    const d = wip(defCard, "e1");
    d.currentHealth = 100;
    s.players.player1.field = [a];
    s.players.player2.field = [d];
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const kinds: string[] = [];
    root.addEventListener(MATCH_ANIM_EVENT, (e) => {
      kinds.push((e as CustomEvent<MatchAnimDetail>).detail.kind);
    });
    buttonByText(root, ".play-match__warrior-btn", "Choose to attack")!.click();
    buttonByText(root, ".play-match__warrior-btn", "Attack")!.click();
    // Events still fire even with motion disabled.
    expect(kinds).toContain("attack");
  });

  it("no-playback mode condenses the opponent turn (no queued timers)", () => {
    window.localStorage.setItem("euphoriaNoPlayback", "1");
    let queued: (() => void) | null = null;
    const scheduler = (cb: () => void): void => {
      queued = cb;
    };
    const match = newMatch(5);
    const root = renderPlayableMatch(
      match,
      { onComplete: noop, onQuit: noop },
      { scheduler },
    );
    buttonByText(root, ".play-match__card-btn", "Summon")!.click();
    root.querySelector<HTMLButtonElement>(".play-match__end")!.click();
    // Opponent reply is applied immediately with no step-by-step playback queue.
    expect(queued).toBeNull();
    expect(root.querySelector(".play-match__playback-banner")).toBeNull();
    root.dispose();
  });

  it("low-power mode caps the rendered battle log at 25 rows", () => {
    window.localStorage.setItem("euphoriaLowPower", "1");
    const agent = smartAgent();
    const match = createPlayableMatch({
      faction: "Sonic", pool: cards, seed: 11, opponentFaction: "Dwarf",
    });
    let guard = 0;
    while (!match.isOver() && match.state().events.length < 200 && guard < 600) {
      const legal = match.legalActions();
      if (legal.length === 0) break;
      match.apply(agent(match.state(), legal));
      guard++;
    }
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const rows = root.querySelectorAll(
      ".play-match__log-entry, .play-match__log-turn",
    ).length;
    expect(rows).toBeLessThanOrEqual(25);
  });
});

describe("renderPlayableMatch — onboarding hints (Feature D)", () => {
  afterEach(() => window.localStorage.clear());

  it("shows the main-phase hint for a new player", () => {
    window.localStorage.clear();
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const hint = root.querySelector(".play-match__tutorial-hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("Summon Warriors");
  });

  it("'Got it' hides the hint for this session", () => {
    window.localStorage.clear();
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    root.querySelector<HTMLButtonElement>(".play-match__tutorial-hint-got")!.click();
    expect(root.querySelector(".play-match__tutorial-hint")).toBeNull();
  });

  it("'Don't show again' persists so a fresh board hides the hint", () => {
    window.localStorage.clear();
    const first = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    first.querySelector<HTMLButtonElement>(".play-match__tutorial-hint-never")!.click();
    // A brand-new board (new match) no longer shows the hint.
    const second = renderPlayableMatch(newMatch(2), { onComplete: noop, onQuit: noop });
    expect(second.querySelector(".play-match__tutorial-hint")).toBeNull();
  });
});

describe("renderPlayableMatch — arena presentation", () => {
  it("tags the board with the player's faction for arena accents", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    expect(root.dataset["faction"]).toBe("Sonic");
    expect(root.classList.contains("play-match")).toBe(true);
  });

  it("renders a HUD banner with the turn and phase", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    const header = root.querySelector(".play-match__header");
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("Turn 1");
    const phase = root.querySelector(".play-match__phase");
    expect(phase).not.toBeNull();
    expect(root.querySelector(".play-match__phase-state")).not.toBeNull();
    expect(root.querySelector(".play-match__phase-sub")!.textContent).toContain("phase");
  });

  it("renders the hand, both seat zones, and the action buttons", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    expect(root.querySelectorAll(".play-match__card").length).toBeGreaterThan(0);
    expect(root.querySelector(".play-match__zone--opponent")).not.toBeNull();
    expect(root.querySelector(".play-match__zone--mine")).not.toBeNull();
    expect(root.querySelector(".play-match__zone--hand")).not.toBeNull();
    expect(root.querySelector(".play-match__enter")).not.toBeNull();
    expect(root.querySelector(".play-match__end")).not.toBeNull();
  });

  it("renders the combat log and toggles its collapsed state", () => {
    // Wide viewport so the log starts expanded (desktop side panel).
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    let log = root.querySelector(".play-match__log")!;
    expect(log).not.toBeNull();
    expect(log.querySelector(".play-match__log-list")).not.toBeNull();
    const toggle = root.querySelector<HTMLButtonElement>(".play-match__log-toggle")!;
    expect(toggle.textContent).toBe("Hide");
    toggle.click();
    // After collapsing, the (re-painted) log is marked collapsed and offers "Show".
    log = root.querySelector(".play-match__log")!;
    expect(log.classList.contains("play-match__log--collapsed")).toBe(true);
    expect(root.querySelector(".play-match__log-toggle")!.textContent).toBe("Show");
  });
});

describe("renderPlayableMatch — battlefield layout", () => {
  it("wraps the board in a structured arena grid with all regions", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    const arena = root.querySelector(".arena");
    expect(arena).not.toBeNull();
    for (const region of [
      ".arena__top",
      ".arena__opp",
      ".arena__lane",
      ".arena__mine",
      ".arena__dock",
    ]) {
      expect(arena!.querySelector(region)).not.toBeNull();
    }
    // The log lives in its own drawer region.
    expect(root.querySelector(".arena__log")).not.toBeNull();
  });

  it("places each board piece in the correct battlefield region", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    expect(root.querySelector(".arena__opp .play-match__zone--opponent")).not.toBeNull();
    expect(root.querySelector(".arena__mine .play-match__zone--mine")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__zone--hand")).not.toBeNull();
    expect(root.querySelector(".arena__lane .play-match__phase")).not.toBeNull();
    // Action buttons stay reachable inside the dock.
    expect(root.querySelector(".arena__dock .play-match__enter")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__end")).not.toBeNull();
  });

  it("keeps the hand and its wired controls intact after reparenting", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const cards = root.querySelectorAll(".arena__dock .play-match__card");
    expect(cards.length).toBeGreaterThan(0);
    // A Summon control still works through the new layout (no logic change).
    const summon = buttonByText(root, ".play-match__card-btn", "Summon");
    expect(summon).toBeDefined();
    summon!.click();
    expect(match.state().players.player1.field.length).toBe(1);
  });
});

describe("renderPlayableMatch — viewport-constrained layout", () => {
  function setWidth(px: number): void {
    Object.defineProperty(window, "innerWidth", { value: px, configurable: true });
  }

  it("starts the combat log collapsed on narrow screens (board owns the view)", () => {
    setWidth(760);
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    const log = root.querySelector(".play-match__log")!;
    expect(log.classList.contains("play-match__log--collapsed")).toBe(true);
    expect(root.querySelector(".play-match__log-toggle")!.textContent).toBe("Show");
  });

  it("keeps the combat log open on wide screens (side panel)", () => {
    setWidth(1400);
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    const log = root.querySelector(".play-match__log")!;
    expect(log.classList.contains("play-match__log--collapsed")).toBe(false);
    expect(root.querySelector(".play-match__log-toggle")!.textContent).toBe("Hide");
  });

  it("still exposes fields, hand, and action buttons inside the arena regions", () => {
    setWidth(1400);
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    expect(root.querySelector(".arena__opp .play-match__field")).not.toBeNull();
    expect(root.querySelector(".arena__mine .play-match__field")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__card")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__enter")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__end")).not.toBeNull();
  });
});

describe("renderPlayableMatch — pinned selected-card action bar", () => {
  function selectSummonCard(root: HTMLElement): void {
    const summon = buttonByText(root, ".play-match__card-btn", "Summon")!;
    summon.closest<HTMLElement>(".play-match__card")!
      .querySelector<HTMLElement>(".play-match__card-face")!
      .click();
  }

  it("renders the action bar in the dock (not the clipped center lane)", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    expect(root.querySelector(".play-match__selected")).toBeNull();
    selectSummonCard(root);
    // The action bar lives in the pinned dock, above the hand.
    expect(root.querySelector(".arena__dock .play-match__selected")).not.toBeNull();
    // Its Summon action is present in the dock — never left in the center lane.
    expect(
      buttonByText(root, ".arena__dock .play-match__selected-actions .play-match__card-btn", "Summon"),
    ).toBeDefined();
    expect(root.querySelector(".arena__lane .play-match__selected")).toBeNull();
  });

  it("keeps the primary action working from the pinned bar", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    selectSummonCard(root);
    buttonByText(root, ".arena__dock .play-match__selected-actions .play-match__card-btn", "Summon")!.click();
    expect(match.state().players.player1.field.length).toBe(1);
  });

  it("swaps the action bar when a different card is selected", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    const nameOf = (c: Element): string =>
      c.querySelector(".play-match__card-name")?.textContent ?? "";

    const first = root.querySelector<HTMLElement>(".arena__dock .play-match__card")!;
    const name0 = nameOf(first);
    first.querySelector<HTMLElement>(".play-match__card-face")!.click();
    expect(root.querySelector(".play-match__selected-title")!.textContent).toContain(name0);

    // Re-query (paint rebuilt the tiles) and pick a differently-named card.
    const other = Array.from(
      root.querySelectorAll<HTMLElement>(".arena__dock .play-match__card"),
    ).find((c) => nameOf(c) !== name0);
    if (other !== undefined) {
      const name1 = nameOf(other);
      other.querySelector<HTMLElement>(".play-match__card-face")!.click();
      expect(root.querySelector(".play-match__selected-title")!.textContent).toContain(name1);
    }
  });

  it("Cancel/Deselect clears the selection and hides the action bar", () => {
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop });
    selectSummonCard(root);
    expect(root.querySelector(".play-match__selected")).not.toBeNull();
    root.querySelector<HTMLButtonElement>(".play-match__selected-cancel")!.click();
    expect(root.querySelector(".play-match__selected")).toBeNull();
  });
});

describe("renderPlayableMatch — selected-card command strip", () => {
  function selectSummon(root: HTMLElement): void {
    buttonByText(root, ".play-match__card-btn", "Summon")!
      .closest<HTMLElement>(".play-match__card")!
      .querySelector<HTMLElement>(".play-match__card-face")!
      .click();
  }

  it("renders a compact command strip (not a large panel) in the dock", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    selectSummon(root);
    const strip = root.querySelector(".arena__dock .arena__command");
    expect(strip).not.toBeNull();
    expect(
      buttonByText(root, ".arena__command .play-match__selected-actions .play-match__card-btn", "Summon"),
    ).toBeDefined();
    expect(strip!.querySelector(".play-match__selected-inspect")).not.toBeNull();
    expect(strip!.querySelector(".play-match__selected-cancel")).not.toBeNull();
  });

  it("keeps the hand and Enter Battle / End Turn visible while a card is selected", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    selectSummon(root);
    expect(root.querySelectorAll(".arena__dock .play-match__card").length).toBeGreaterThan(0);
    expect(root.querySelector(".arena__dock .play-match__enter")).not.toBeNull();
    expect(root.querySelector(".arena__dock .play-match__end")).not.toBeNull();
  });

  it("does not leave a selected panel in the center lane or player field", () => {
    const root = renderPlayableMatch(newMatch(), { onComplete: noop, onQuit: noop });
    selectSummon(root);
    expect(root.querySelector(".arena__lane .play-match__selected")).toBeNull();
    expect(root.querySelector(".arena__mine .play-match__selected")).toBeNull();
    expect(root.querySelector(".arena__dock .arena__command")).not.toBeNull();
  });
});
