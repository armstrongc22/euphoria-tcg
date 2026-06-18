/**
 * @vitest-environment jsdom
 *
 * Interactive match board (play-match-view.ts), driven through the DOM with
 * jsdom: legal-action rendering, disabled states for illegal plays, the summon
 * flow via a button click, and that a finished match fires onComplete with the
 * summary (so the result/history/reward flow downstream still runs).
 */
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@euphoria/card-data/schema";
import type { GameState, WarriorInPlay } from "@euphoria/game-engine";
import { cards } from "../src/cards";
import { createPlayableMatch } from "../src/play-match";
import { battleLogLines, renderPlayableMatch } from "../src/play-match-view";
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

  it("keeps live cards inspectable and shows an art thumbnail", () => {
    const onInspect = vi.fn();
    const match = newMatch();
    const root = renderPlayableMatch(match, { onComplete: noop, onQuit: noop, onInspect });
    const body = root.querySelector<HTMLButtonElement>(".play-match__card-inspect")!;
    expect(body.querySelector("img.play-match__art")).not.toBeNull();
    body.click();
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
