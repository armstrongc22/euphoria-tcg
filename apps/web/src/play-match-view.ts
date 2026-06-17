/**
 * Interactive match board. A self-re-rendering DOM component (jsdom-testable):
 * given a {@link PlayableMatch}, it draws the player's hand, both fields, Spirit
 * and lives, and a battle log, and wires every control to an action taken
 * straight from `match.legalActions()`. It never builds actions itself, so the
 * UI can only ever offer legal moves; cards/warriors with no legal action are
 * rendered disabled with a short reason.
 *
 * Scope (first version): summon (playWarrior), play Item, equip Weapon, reclaim
 * a stolen Warrior, enter Battle, attack / direct attack, and end turn — i.e.
 * every action kind the engine currently exposes through getLegalActions. Attack
 * cards are auto-skipped (the engine's skip variant is used); per-Item targeting
 * beyond the engine defaults is a known later step.
 */
import type { Card } from "@euphoria/card-data/schema";
import type {
  GameAction,
  GameState,
  PlayerState,
  WarriorInPlay,
} from "@euphoria/game-engine";
import {
  getDeckSearchTargets,
  getFriendlyWarriorTargets,
  getReviveTargets,
  getStealTargets,
  isDeckSearchItem,
  isFriendlyWarriorTargetItem,
  isOutDeckReviveItem,
  isStealHandItem,
} from "@euphoria/game-engine";
import type { MatchSummary } from "./match";
import { OPPONENT_SEAT, PLAYER_SEAT, type PlayableMatch } from "./play-match";
import {
  battleLogLines,
  toPlaybackSteps,
  type PlaybackStep,
} from "./match-playback";

/** Re-exported so existing callers keep importing it from the view. */
export { battleLogLines } from "./match-playback";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** True when an attack action resolves through a chosen Attack card. */
function hasAttackCard(action: GameAction): boolean {
  return action.kind === "attack" && action.selectedAttackCardId !== undefined;
}

/** How playback delays are scheduled; injectable so tests can step manually. */
export type PlaybackScheduler = (cb: () => void, ms: number) => void;

/** Extra options for the board (playback pacing, mainly for tests). */
export interface PlayableMatchViewOptions {
  /** Schedules each playback advance; defaults to setTimeout. */
  readonly scheduler?: PlaybackScheduler;
  /** Override per-step delay (ms); defaults to each step's own duration. */
  readonly stepDelayMs?: number;
}

/** Callbacks for the board. */
export interface PlayableMatchActions {
  /** Fired once when the match ends, with the final summary. */
  readonly onComplete: (summary: MatchSummary) => void;
  /** Fired when the player concedes / quits back out. */
  readonly onQuit: () => void;
  /**
   * Fired when the user taps a card's art/name/body to inspect it. Wired by the
   * mount (account-view) to the shared card-detail modal, the same one the Card
   * Viewer and Deck Builder use. Omitted in pure tests that only assert wiring.
   */
  readonly onInspect?: (card: Card) => void;
}

/**
 * Renders the board for `match` into a fresh element and returns it. The element
 * re-renders itself in place after every action, and plays the opponent's turn
 * back step by step (floating combat text + a current-action callout) instead of
 * jumping straight to the result. Pure of network/auth; the only outside effects
 * are the supplied callbacks.
 */
export function renderPlayableMatch(
  match: PlayableMatch,
  actions: PlayableMatchActions,
  options: PlayableMatchViewOptions = {},
): HTMLElement {
  const root = document.createElement("section");
  root.className = "account play-match";

  // Transient UI selection state, reset on every successful action.
  let selectedAttacker: string | null = null;
  let pendingWeapon: string | null = null;
  // An open Attack-card prompt for a declared (attacker → defender) pair.
  let pendingAttack: { attacker: string; defender: string } | null = null;
  // An open revive-target prompt for a chosen Out-Deck revive Item (card id).
  let pendingRevive: string | null = null;
  // An open deck-search prompt for a chosen SEARCH_DECK Item (card id).
  let pendingSearch: string | null = null;
  // An open hand-steal prompt for a chosen STEAL_ITEM_FROM_HAND Item (card id).
  let pendingSteal: string | null = null;
  // An Item awaiting a friendly-Warrior target on the field (card id), e.g. GILs Unit.
  let pendingItemTarget: string | null = null;
  let error: string | null = null;
  let completed = false;

  // --- playback (opponent turn) + floating-text state ----------------------
  const schedule: PlaybackScheduler =
    options.scheduler ?? ((cb, ms) => void setTimeout(cb, ms));
  // Set while the opponent's turn is animating: input is locked and the board
  // renders the step's snapshot instead of the live state.
  let playback: { steps: PlaybackStep[]; index: number } | null = null;
  // The current-action callout text (player action or current playback step).
  let callout: string | null = null;
  // Floating combat texts to overlay on the current paint.
  let floaters: PlaybackStep[] = [];

  const clearSelections = (): void => {
    selectedAttacker = null;
    pendingWeapon = null;
    pendingAttack = null;
    pendingRevive = null;
    pendingSearch = null;
    pendingSteal = null;
    pendingItemTarget = null;
  };

  const startPlayback = (steps: PlaybackStep[]): void => {
    playback = { steps, index: 0 };
    paint();
    scheduleNext();
  };

  const scheduleNext = (): void => {
    if (playback === null) return;
    const step = playback.steps[playback.index]!;
    schedule(() => {
      if (playback === null) return;
      playback.index += 1;
      if (playback.index >= playback.steps.length) {
        playback = null;
        callout = null;
        floaters = [];
        paint();
      } else {
        paint();
        scheduleNext();
      }
    }, options.stepDelayMs ?? step.durationMs);
  };

  const act = (action: GameAction): void => {
    // Input is locked while the opponent's turn plays back.
    if (playback !== null) return;
    const res = match.apply(action);
    clearSelections();
    if (!res.ok) {
      error = res.message;
      paint();
      return;
    }
    error = null;
    const steps = toPlaybackSteps(res.frames);
    const passedTurn = res.frames.some((f) => f.actor === "opponent");
    if (passedTurn && steps.length > 0) {
      // The turn passed to the AI: play the whole reply back, locked.
      floaters = [];
      startPlayback(steps);
    } else {
      // Still the player's turn: immediate floating feedback, no lock.
      floaters = steps.filter((s) => s.floatingText !== undefined);
      callout = steps.length > 0 ? steps[steps.length - 1]!.message : null;
      paint();
    }
  };

  // --- legal-action indexes, rebuilt each paint -----------------------------
  interface ActionIndex {
    playWarrior: Map<string, GameAction>;
    playItem: Map<string, GameAction>;
    equip: Map<string, GameAction[]>;
    reclaim: Map<string, GameAction>;
    // attacker → defender → all legal attack variants (regular + one per
    // compatible Attack card). The UI prompts when more than one exists.
    attack: Map<string, Map<string, GameAction[]>>;
    direct: Map<string, GameAction>;
    enterBattle?: GameAction;
    endTurn?: GameAction;
  }

  const indexLegal = (legal: readonly GameAction[]): ActionIndex => {
    const idx: ActionIndex = {
      playWarrior: new Map(),
      playItem: new Map(),
      equip: new Map(),
      reclaim: new Map(),
      attack: new Map(),
      direct: new Map(),
    };
    for (const a of legal) {
      switch (a.kind) {
        case "playWarrior":
          idx.playWarrior.set(a.cardId, a);
          break;
        case "playItem":
          if (!idx.playItem.has(a.cardId)) idx.playItem.set(a.cardId, a);
          break;
        case "equipWeapon": {
          const list = idx.equip.get(a.cardId) ?? [];
          list.push(a);
          idx.equip.set(a.cardId, list);
          break;
        }
        case "reclaimWarrior":
          idx.reclaim.set(a.warriorInstanceId, a);
          break;
        case "attack": {
          const byDef =
            idx.attack.get(a.attackerInstanceId) ??
            new Map<string, GameAction[]>();
          // Keep every variant for this (attacker, defender): the bare/skip
          // attack and one per compatible Attack card, so the UI can prompt.
          const list = byDef.get(a.defenderInstanceId) ?? [];
          list.push(a);
          byDef.set(a.defenderInstanceId, list);
          idx.attack.set(a.attackerInstanceId, byDef);
          break;
        }
        case "directAttack":
          idx.direct.set(a.attackerInstanceId, a);
          break;
        case "enterBattle":
          idx.enterBattle = a;
          break;
        case "endTurn":
          idx.endTurn = a;
          break;
      }
    }
    return idx;
  };

  // --- small DOM builders ---------------------------------------------------
  const statBar = (label: string, p: PlayerState): HTMLElement => {
    const el = document.createElement("div");
    el.className = "play-match__stats";
    el.dataset.seat = p.id; // anchor for "-1 LIFE" floats on direct attacks
    el.innerHTML =
      `<span class="play-match__seat">${escapeHtml(label)}</span>` +
      `<span class="play-match__stat play-match__stat--lives" title="Lives">` +
      `♥ ${p.lives}</span>` +
      `<span class="play-match__stat play-match__stat--spirit" title="Spirit">` +
      `◆ ${p.spirit}</span>` +
      `<span class="play-match__stat" title="Cards in hand">✋ ${p.hand.length}</span>`;
    return el;
  };

  // Opens the shared card-detail modal for `card`, when an inspector is wired.
  const inspect = (card: Card): void => actions.onInspect?.(card);

  // A Warrior tile: an inspectable body (art/name/stats — taps open the detail
  // modal, never a gameplay action) plus zero or more explicit action buttons.
  // The attached Weapon, if any, is its own inspectable chip.
  const warriorEl = (
    w: WarriorInPlay,
    opts: {
      highlighted?: boolean;
      selected?: boolean;
      badge?: string;
      controls?: HTMLButtonElement[];
    },
  ): HTMLElement => {
    const el = document.createElement("div");
    el.className =
      "play-match__warrior" +
      (opts.selected ? " play-match__warrior--selected" : "") +
      (opts.highlighted ? " play-match__warrior--target" : "");
    el.dataset.instance = w.instanceId; // anchor for floating combat text

    const body = document.createElement("button");
    body.type = "button";
    body.className = "play-match__warrior-inspect";
    body.title = "View card details";
    body.innerHTML =
      `<span class="play-match__warrior-name">${escapeHtml(w.card.name)}</span>` +
      `<span class="play-match__warrior-stats">${w.currentAttack} / ${w.currentHealth}</span>` +
      `<span class="play-match__warrior-meta">⚡${w.attacksRemaining}</span>` +
      (opts.badge ? `<span class="play-match__warrior-badge">${escapeHtml(opts.badge)}</span>` : "");
    body.addEventListener("click", () => inspect(w.card));
    el.append(body);

    if (w.attachedWeapon !== undefined) {
      const weapon = w.attachedWeapon;
      const weaponBtn = document.createElement("button");
      weaponBtn.type = "button";
      weaponBtn.className = "play-match__weapon-inspect";
      weaponBtn.title = "View Weapon details";
      weaponBtn.textContent = `⚔ ${weapon.name}`;
      weaponBtn.addEventListener("click", () => inspect(weapon));
      el.append(weaponBtn);
    }

    if (opts.controls && opts.controls.length > 0) {
      const controls = document.createElement("div");
      controls.className = "play-match__warrior-controls";
      controls.append(...opts.controls);
      el.append(controls);
    }
    return el;
  };

  // A small gameplay-action button shown on a Warrior tile.
  const warriorBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__warrior-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  // A button inside a choice prompt.
  const choiceBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__choice-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  const cancelRow = (onCancel: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__choice-cancel";
    b.textContent = "Cancel";
    b.addEventListener("click", onCancel);
    return b;
  };

  // "Use an Attack card?" — shown after declaring an attack whose attacker has
  // compatible Attack cards in hand. Offers a regular attack, each Attack-card
  // option, and Cancel. Every option maps to a legal action from the engine.
  const attackChoicePanel = (idx: ActionIndex, me: PlayerState): HTMLElement | null => {
    if (pendingAttack === null) return null;
    const variants = idx.attack.get(pendingAttack.attacker)?.get(pendingAttack.defender);
    if (variants === undefined || variants.length === 0) return null;

    const panel = document.createElement("section");
    panel.className = "account__panel play-match__choice";
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent = "Use an Attack card?";
    panel.append(heading);

    const regular =
      variants.find((a) => a.kind === "attack" && a.skipAttackCard === true) ??
      variants.find((a) => a.kind === "attack" && a.selectedAttackCardId === undefined);
    if (regular !== undefined) {
      panel.append(choiceBtn("Regular attack (no card)", () => act(regular)));
    }
    for (const variant of variants) {
      if (variant.kind !== "attack" || variant.selectedAttackCardId === undefined) continue;
      const card = me.hand.find((c) => c.id === variant.selectedAttackCardId);
      const row = document.createElement("div");
      row.className = "play-match__choice-option";
      if (card !== undefined) {
        const look = document.createElement("button");
        look.type = "button";
        look.className = "play-match__card-inspect";
        look.title = "View card details";
        look.innerHTML =
          `<span class="play-match__card-name">${escapeHtml(card.name)}</span>` +
          `<span class="play-match__card-meta">Attack · ◆${card.cost}</span>`;
        look.addEventListener("click", () => inspect(card));
        row.append(look);
      }
      row.append(
        choiceBtn(
          card !== undefined ? `Use ${card.name}` : "Use Attack card",
          () => act(variant),
        ),
      );
      panel.append(row);
    }
    panel.append(
      cancelRow(() => {
        pendingAttack = null;
        paint();
      }),
    );
    return panel;
  };

  // Shared "pick one card" prompt used by the revive (Totem's Creation) and
  // deck-search (Lahkt) flows: a heading, one inspectable row per candidate with
  // an action button, and Cancel. Each option maps to a legal action.
  const targetChoicePanel = (
    heading: string,
    targets: readonly Card[],
    optionLabel: (card: Card) => string,
    toAction: (card: Card) => GameAction,
    onCancel: () => void,
  ): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "account__panel play-match__choice";
    const h = document.createElement("h3");
    h.className = "account__panel-heading";
    h.textContent = heading;
    panel.append(h);

    for (const target of targets) {
      const row = document.createElement("div");
      row.className = "play-match__choice-option";
      const look = document.createElement("button");
      look.type = "button";
      look.className = "play-match__card-inspect";
      look.title = "View card details";
      look.innerHTML =
        `<span class="play-match__card-name">${escapeHtml(target.name)}</span>` +
        `<span class="play-match__card-meta">${escapeHtml(target.faction)} · ` +
        `${escapeHtml(target.type)}</span>`;
      look.addEventListener("click", () => inspect(target));
      row.append(look);
      row.append(choiceBtn(optionLabel(target), () => act(toAction(target))));
      panel.append(row);
    }
    panel.append(cancelRow(onCancel));
    return panel;
  };

  // "Choose a Warrior to revive" — shown after playing a revive Item (Totem's
  // Creation), resolving via playItem + targetOutDeckCardId.
  const reviveChoicePanel = (state: GameState, me: PlayerState): HTMLElement | null => {
    if (pendingRevive === null) return null;
    const card = me.hand.find((c) => c.id === pendingRevive);
    if (card === undefined) return null;
    const targets = getReviveTargets(state, card);
    if (targets.length === 0) return null;
    return targetChoicePanel(
      `Revive a Warrior with ${card.name}`,
      targets,
      (t) => `Revive ${t.name}`,
      (t) => ({ kind: "playItem", cardId: card.id, targetOutDeckCardId: t.id }),
      () => {
        pendingRevive = null;
        paint();
      },
    );
  };

  // "Add an Item/Weapon to hand" — shown after playing a deck-search Item (Lahkt
  // Brand Family Products), resolving via playItem + targetDeckCardId.
  const deckSearchChoicePanel = (
    state: GameState,
    me: PlayerState,
  ): HTMLElement | null => {
    if (pendingSearch === null) return null;
    const card = me.hand.find((c) => c.id === pendingSearch);
    if (card === undefined) return null;
    const targets = getDeckSearchTargets(state, card);
    if (targets.length === 0) return null;
    return targetChoicePanel(
      `Add a card to hand with ${card.name}`,
      targets,
      (t) => `Add ${t.name}`,
      (t) => ({ kind: "playItem", cardId: card.id, targetDeckCardId: t.id }),
      () => {
        pendingSearch = null;
        paint();
      },
    );
  };

  // "Take an Item from the opponent's hand" — shown after playing a hand-steal
  // Item (A Thief's Pride), resolving via playItem + targetOpponentHandCardId.
  const stealChoicePanel = (
    state: GameState,
    me: PlayerState,
  ): HTMLElement | null => {
    if (pendingSteal === null) return null;
    const card = me.hand.find((c) => c.id === pendingSteal);
    if (card === undefined) return null;
    const targets = getStealTargets(state, card);
    if (targets.length === 0) return null;
    return targetChoicePanel(
      `Take an Item from the opponent's hand with ${card.name}`,
      targets,
      (t) => `Take ${t.name}`,
      (t) => ({ kind: "playItem", cardId: card.id, targetOpponentHandCardId: t.id }),
      () => {
        pendingSteal = null;
        paint();
      },
    );
  };

  // --- the painter ----------------------------------------------------------
  function paint(): void {
    const playing = playback !== null;
    // onComplete fires only once playback (if any) has finished.
    if (!playing && match.isOver()) {
      if (!completed) {
        completed = true;
        actions.onComplete(match.summary());
      }
      return;
    }

    const step = playing ? playback!.steps[playback!.index]! : null;
    // During playback we render the step's board snapshot; otherwise the live
    // state. Legal actions are suppressed during playback so every gameplay
    // control is disabled — the player can't act mid-opponent-turn.
    const state = step ? step.state : match.state();
    const me = state.players[PLAYER_SEAT];
    const opp = state.players[OPPONENT_SEAT];
    const legal = playing ? [] : match.legalActions();
    const idx = indexLegal(legal);
    const yourTurn = state.activePlayer === PLAYER_SEAT;

    const frag = document.createDocumentFragment();

    // Header: turn / phase / whose turn + concede.
    const header = document.createElement("div");
    header.className = "account__header play-match__header";
    const mode = playing
      ? "Opponent is acting…"
      : yourTurn
        ? "Your move"
        : "Opponent…";
    header.innerHTML =
      `<p class="account__eyebrow">Euphoria TCG · Live match</p>` +
      `<h2 class="account__title">${escapeHtml(match.playerFaction)} vs ` +
      `${escapeHtml(match.opponentFaction)}</h2>` +
      `<p class="account__mode">Turn ${state.turn} · ${escapeHtml(state.phase)} phase · ` +
      `${escapeHtml(mode)}</p>`;
    const concede = document.createElement("button");
    concede.type = "button";
    concede.className = "account__signout play-match__quit";
    concede.textContent = "Concede";
    concede.addEventListener("click", actions.onQuit);
    header.append(concede);
    frag.append(header);

    // "Opponent is acting…" banner during playback.
    if (playing) {
      const banner = document.createElement("p");
      banner.className = "play-match__playback-banner";
      banner.textContent = "Opponent is acting…";
      frag.append(banner);
    }

    // Current-action callout, visible without scrolling (Feature D).
    const calloutText = step ? step.message : callout;
    const calloutEl = document.createElement("p");
    calloutEl.className = "play-match__callout";
    calloutEl.textContent = calloutText && calloutText.length > 0 ? calloutText : " ";
    frag.append(calloutEl);

    if (error !== null) {
      const err = document.createElement("p");
      err.className = "play-match__error";
      err.textContent = error;
      frag.append(err);
    }

    const hint = document.createElement("p");
    hint.className = "play-match__hint";
    hint.textContent = "Tap any card to view its full details.";
    frag.append(hint);

    // Pending choice prompts (player-only; never during playback).
    if (!playing) {
      const attackPanel = attackChoicePanel(idx, me);
      if (attackPanel !== null) frag.append(attackPanel);
      const revivePanel = reviveChoicePanel(state, me);
      if (revivePanel !== null) frag.append(revivePanel);
      const searchPanel = deckSearchChoicePanel(state, me);
      if (searchPanel !== null) frag.append(searchPanel);
      const stealPanel = stealChoicePanel(state, me);
      if (stealPanel !== null) frag.append(stealPanel);
    }

    // Opponent: stats + field.
    frag.append(statBar("Opponent", opp));
    frag.append(fieldRow(opp, /* mine */ false, idx));

    // Player: field + stats + hand.
    frag.append(fieldRow(me, /* mine */ true, idx));
    frag.append(statBar("You", me));
    frag.append(handRow(me, idx));

    // Action bar: enter battle / end turn (disabled during playback).
    const bar = document.createElement("div");
    bar.className = "play-match__actionbar";
    bar.append(
      barButton("Enter Battle", idx.enterBattle, "play-match__enter"),
      barButton("End Turn", idx.endTurn, "play-match__end"),
    );
    frag.append(bar);

    // Battle log (full history).
    frag.append(logPanel(state));

    // Floating combat text overlays, anchored to their target if visible.
    const activeFloaters = step
      ? step.floatingText !== undefined
        ? [step]
        : []
      : floaters;
    renderFloaters(frag, activeFloaters);

    root.replaceChildren(frag);
  }

  /** Anchors each floater near its target Warrior tile or player life area. */
  function renderFloaters(frag: DocumentFragment, steps: PlaybackStep[]): void {
    for (const step of steps) {
      if (step.floatingText === undefined) continue;
      const float = document.createElement("span");
      float.className = `play-match__float play-match__float--${step.tone}`;
      float.textContent = step.floatingText;

      let anchor: Element | null = null;
      if (step.targetInstanceId !== undefined) {
        anchor = frag.querySelector(`[data-instance="${step.targetInstanceId}"]`);
      } else if (step.targetPlayer !== undefined) {
        anchor = frag.querySelector(`[data-seat="${step.targetPlayer}"]`);
      }
      // Fallback: the relevant field zone, else the board itself, so the text is
      // never lost (e.g. a Warrior already removed by its own destruction).
      if (anchor === null && step.targetPlayer !== undefined) {
        anchor = frag.querySelector(`[data-seat="${step.targetPlayer}"]`);
      }
      if (anchor === null) {
        anchor = frag.querySelector(".play-match__field--theirs");
      }
      if (anchor instanceof HTMLElement) anchor.append(float);
    }
  }

  const barButton = (
    label: string,
    action: GameAction | undefined,
    cls: string,
  ): HTMLElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `account__play ${cls}`;
    b.textContent = label;
    b.disabled = action === undefined;
    if (action !== undefined) b.addEventListener("click", () => act(action));
    return b;
  };

  const fieldRow = (
    player: PlayerState,
    mine: boolean,
    idx: ActionIndex,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = `play-match__field play-match__field--${mine ? "mine" : "theirs"}`;
    if (player.field.length === 0) {
      const empty = document.createElement("p");
      empty.className = "play-match__empty";
      empty.textContent = mine ? "No Warriors in play." : "Opponent has no Warriors.";
      row.append(empty);
      return row;
    }
    for (const w of player.field) {
      if (mine) {
        // While choosing a Weapon target, friendly Warriors that can take it get
        // an "Equip here" control; an attack-capable Warrior gets a select/cancel
        // toggle. The tile body always stays inspectable regardless.
        const equipTarget =
          pendingWeapon !== null
            ? (idx.equip.get(pendingWeapon) ?? []).find(
                (a) => a.kind === "equipWeapon" && a.warriorInstanceId === w.instanceId,
              )
            : undefined;
        const canAttack = idx.attack.has(w.instanceId) || idx.direct.has(w.instanceId);
        // While an Item is awaiting a friendly-Warrior target, only Warriors the
        // engine would actually accept (faction/precondition-limited) get a pick.
        const itemTargetCard =
          pendingItemTarget !== null
            ? player.hand.find((c) => c.id === pendingItemTarget)
            : undefined;
        const isItemTarget =
          itemTargetCard !== undefined &&
          getFriendlyWarriorTargets(match.state(), itemTargetCard).some(
            (t) => t.instanceId === w.instanceId,
          );
        const controls: HTMLButtonElement[] = [];
        if (equipTarget !== undefined) {
          controls.push(warriorBtn("Equip here", () => act(equipTarget)));
        }
        if (isItemTarget) {
          const cardId = itemTargetCard!.id;
          controls.push(
            warriorBtn("Use here", () =>
              act({ kind: "playItem", cardId, targetInstanceId: w.instanceId }),
            ),
          );
        }
        if (canAttack) {
          controls.push(
            selectedAttacker === w.instanceId
              ? warriorBtn("✓ Attacking — cancel", () => {
                  selectedAttacker = null;
                  error = null;
                  paint();
                })
              : warriorBtn("Choose to attack", () => {
                  selectedAttacker = w.instanceId;
                  error = null;
                  paint();
                }),
          );
        }
        row.append(
          warriorEl(w, {
            selected: selectedAttacker === w.instanceId,
            highlighted: equipTarget !== undefined || isItemTarget,
            controls,
          }),
        );
      } else {
        // Enemy Warrior: an "Attack" control while an attacker is selected and
        // this is a legal target, or "Reclaim" if it is one of ours under
        // foreign control. Body stays inspectable either way.
        const variants =
          selectedAttacker !== null
            ? idx.attack.get(selectedAttacker)?.get(w.instanceId)
            : undefined;
        const reclaim = idx.reclaim.get(w.instanceId);
        const controls: HTMLButtonElement[] = [];
        if (variants !== undefined && variants.length > 0) {
          const attacker = selectedAttacker!;
          controls.push(
            warriorBtn("Attack", () => {
              // If any variant uses an Attack card, prompt to choose; otherwise
              // resolve the single regular attack immediately.
              if (variants.some((a) => hasAttackCard(a))) {
                pendingAttack = { attacker, defender: w.instanceId };
                error = null;
                paint();
              } else {
                act(variants[0]!);
              }
            }),
          );
        }
        if (reclaim !== undefined) {
          controls.push(warriorBtn("Reclaim", () => act(reclaim)));
        }
        row.append(
          warriorEl(w, {
            highlighted: variants !== undefined && variants.length > 0,
            badge: reclaim !== undefined ? "reclaim" : undefined,
            controls,
          }),
        );
      }
    }
    // Direct attack lives with the player's field when an attacker is selected
    // and the opponent's field is empty.
    if (mine && selectedAttacker !== null && idx.direct.has(selectedAttacker)) {
      const direct = idx.direct.get(selectedAttacker)!;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "account__play play-match__direct";
      b.textContent = "Direct attack";
      b.addEventListener("click", () => act(direct));
      row.append(b);
    }
    return row;
  };

  const handRow = (me: PlayerState, idx: ActionIndex): HTMLElement => {
    const row = document.createElement("div");
    row.className = "play-match__hand";
    if (me.hand.length === 0) {
      const empty = document.createElement("p");
      empty.className = "play-match__empty";
      empty.textContent = "Your hand is empty.";
      row.append(empty);
      return row;
    }
    const seen = new Set<string>();
    for (const card of me.hand) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      const copies = me.hand.filter((c) => c.id === card.id).length;

      const el = document.createElement("div");
      el.className = "play-match__card";

      // The card body (name + type/cost) is an inspect button — tapping it opens
      // the detail modal, never plays the card. Action buttons live separately.
      const body = document.createElement("button");
      body.type = "button";
      body.className = "play-match__card-inspect";
      body.title = "View card details";
      body.innerHTML =
        `<span class="play-match__card-name">${escapeHtml(card.name)}` +
        `${copies > 1 ? ` ×${copies}` : ""}</span>` +
        `<span class="play-match__card-meta">${escapeHtml(card.type)} · ` +
        `◆${card.cost}</span>`;
      body.addEventListener("click", () => inspect(card));
      el.append(body);

      const controls = document.createElement("div");
      controls.className = "play-match__card-controls";

      const playWarrior = idx.playWarrior.get(card.id);
      const playItem = idx.playItem.get(card.id);
      const equip = idx.equip.get(card.id);

      if (playWarrior !== undefined) {
        controls.append(cardButton("Summon", () => act(playWarrior)));
      } else if (playItem !== undefined && isOutDeckReviveItem(card)) {
        // Revive Items (Totem's Creation) need a chosen Out-Deck Warrior. Guard
        // the no-target and field-full cases with a clear, disabled message
        // rather than wasting the card on a no-op resolution.
        const fieldFull = me.field.length >= match.state().config.warriorSlots;
        const targets = getReviveTargets(match.state(), card);
        if (fieldFull) {
          controls.append(cardButton("Field is full", undefined));
        } else if (targets.length === 0) {
          controls.append(cardButton("No Warrior to revive", undefined));
        } else {
          const b = cardButton(
            pendingRevive === card.id ? "Pick a Warrior…" : "Play",
            () => {
              pendingRevive = pendingRevive === card.id ? null : card.id;
              error = null;
              paint();
            },
          );
          if (pendingRevive === card.id) b.classList.add("play-match__card-btn--active");
          controls.append(b);
        }
      } else if (playItem !== undefined && isDeckSearchItem(card)) {
        // Deck-search Items (Lahkt) need a chosen deck card. Guard the no-target
        // case with a clear, disabled message rather than wasting the card.
        const targets = getDeckSearchTargets(match.state(), card);
        if (targets.length === 0) {
          controls.append(cardButton("No Item/Weapon in deck", undefined));
        } else {
          const b = cardButton(
            pendingSearch === card.id ? "Pick a card…" : "Play",
            () => {
              pendingSearch = pendingSearch === card.id ? null : card.id;
              error = null;
              paint();
            },
          );
          if (pendingSearch === card.id) b.classList.add("play-match__card-btn--active");
          controls.append(b);
        }
      } else if (playItem !== undefined && isStealHandItem(card)) {
        // Hand-steal Items (A Thief's Pride) need a chosen opponent-hand Item.
        const targets = getStealTargets(match.state(), card);
        if (targets.length === 0) {
          controls.append(cardButton("No Item in opponent's hand", undefined));
        } else {
          const b = cardButton(
            pendingSteal === card.id ? "Pick a card…" : "Play",
            () => {
              pendingSteal = pendingSteal === card.id ? null : card.id;
              error = null;
              paint();
            },
          );
          if (pendingSteal === card.id) b.classList.add("play-match__card-btn--active");
          controls.append(b);
        }
      } else if (playItem !== undefined && isFriendlyWarriorTargetItem(card)) {
        // Items that target a friendly Warrior on the field (GILs Unit) need a
        // chosen Warrior. Disable clearly when the player controls none.
        const targets = getFriendlyWarriorTargets(match.state(), card);
        if (targets.length === 0) {
          controls.append(cardButton("No Warrior to target", undefined));
        } else {
          const b = cardButton(
            pendingItemTarget === card.id ? "Pick a Warrior…" : "Play",
            () => {
              pendingItemTarget = pendingItemTarget === card.id ? null : card.id;
              error = null;
              paint();
            },
          );
          if (pendingItemTarget === card.id) b.classList.add("play-match__card-btn--active");
          controls.append(b);
        }
      } else if (playItem !== undefined) {
        controls.append(cardButton("Play", () => act(playItem)));
      } else if (equip !== undefined && equip.length > 0) {
        const b = cardButton(
          pendingWeapon === card.id ? "Pick a Warrior…" : "Equip",
          () => {
            pendingWeapon = pendingWeapon === card.id ? null : card.id;
            error = null;
            paint();
          },
        );
        if (pendingWeapon === card.id) b.classList.add("play-match__card-btn--active");
        controls.append(b);
      } else {
        // No legal play for this card right now — show why, disabled.
        const summonUsedUp =
          card.type === "Warrior" &&
          me.warriorSummonsUsedThisTurn >= match.state().config.warriorSummonsPerTurn;
        const reason =
          card.cost > me.spirit
            ? "Not enough Spirit"
            : match.state().phase === "battle"
              ? "Not during Battle"
              : summonUsedUp
                ? "One summon per turn"
                : card.type === "Weapon"
                  ? "No Warrior to equip"
                  : card.type === "Attack"
                    ? "Used with an attack"
                    : "No legal play";
        const b = cardButton(reason, undefined);
        controls.append(b);
      }
      el.append(controls);
      row.append(el);
    }
    return row;
  };

  const cardButton = (label: string, onClick?: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__card-btn";
    b.textContent = label;
    b.disabled = onClick === undefined;
    if (onClick !== undefined) b.addEventListener("click", onClick);
    return b;
  };

  const logPanel = (state: GameState): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "account__panel play-match__log";
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent = "Battle log";
    panel.append(heading);
    const ul = document.createElement("ul");
    ul.className = "play-match__log-list";
    const lines = battleLogLines(state);
    if (lines.length === 0) {
      const li = document.createElement("li");
      li.className = "play-match__log-empty";
      li.textContent = "The match has begun.";
      ul.append(li);
    }
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.append(li);
    }
    panel.append(ul);
    // Most recent entries at the bottom; keep them in view as the log grows.
    ul.scrollTop = ul.scrollHeight;
    return panel;
  };

  paint();
  return root;
}
