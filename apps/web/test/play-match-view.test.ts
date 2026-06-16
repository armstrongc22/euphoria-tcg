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
import type { WarriorInPlay } from "@euphoria/game-engine";
import { cards } from "../src/cards";
import { createPlayableMatch } from "../src/play-match";
import { renderPlayableMatch } from "../src/play-match-view";
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
