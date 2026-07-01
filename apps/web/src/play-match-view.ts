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
  getEnemyWarriorTargets,
  getForcedDuelEnemyTargets,
  getForcedDuelFriendlyTargets,
  getFriendlyWarriorTargets,
  getGylippusSecondaryTargets,
  getMoiraiExtraAttackTargets,
  getReviveTargets,
  getScytheCycleSplashTargets,
  getStealTargets,
  isDeckSearchItem,
  isEnemyWarriorTargetItem,
  isForcedDuelItem,
  isFriendlyWarriorTargetItem,
  isGylippusAttackCard,
  isOutDeckReviveItem,
  isStealHandItem,
} from "@euphoria/game-engine";
import { cardImageUrl, cardThumbUrl, preloadCardArt } from "@euphoria/core/cards";
import type { MatchSummary } from "@euphoria/core/match";
import { OPPONENT_SEAT, PLAYER_SEAT, type PlayableMatch } from "@euphoria/core/play-match";
import {
  battleLogEntries,
  toPlaybackSteps,
  MATCH_ANIM_EVENT,
  type MatchAnimDetail,
  type PlaybackStep,
} from "@euphoria/core/match-playback";
import { recordMatchMetrics, setMatchActive, setMetricsProvider } from "@euphoria/core/debug-log";
import {
  dismissTutorial,
  getTutorialStore,
  isTutorialDismissed,
} from "@euphoria/core/tutorial";
import {
  artCacheCap,
  lowPowerActive,
  noAnim,
  noArt,
  noPlayback,
  renderedLogCap,
} from "./debug-flags";

/** Base path Vite serves card art from (see cardImageUrl). */
const LIVE_ART_BASE = import.meta.env.BASE_URL;

/** Re-exported so existing callers keep importing it from the view. */
export { battleLogLines } from "@euphoria/core/match-playback";

/**
 * How many battle-log rows the live board keeps in the DOM. The full history is
 * still computed (and the simulator/log stay complete) — but rendering every row
 * on every repaint is what made long mobile matches grow an unbounded DOM and
 * forced the tab to reload after ~12–15 turns. Capping the *rendered* tail keeps
 * the live container's node count and per-repaint cost bounded at any length.
 */
export const MAX_RENDERED_LOG_ENTRIES = 60;
/** Re-exported so callers (and later, a sound layer) can subscribe to moments. */
export { MATCH_ANIM_EVENT, type MatchAnimDetail } from "@euphoria/core/match-playback";

/**
 * Runs a Web Animations API keyframe effect when supported, and never throws
 * where it isn't (jsdom has no Element.animate). Returns the Animation or null.
 * All board animations go through here so tests (and reduced-motion) stay safe.
 */
function playAnim(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (el === null || el === undefined) return null;
  const target = el as HTMLElement & { getAnimations?: () => Animation[] };
  const animate = target.animate;
  if (typeof animate !== "function") return null;
  try {
    // Cancel any in-flight animation on this element so they never stack up
    // (Part D: bound the number of live Animation objects on mobile).
    if (typeof target.getAnimations === "function") {
      for (const a of target.getAnimations()) a.cancel();
    }
    return animate.call(el, keyframes, options);
  } catch {
    return null;
  }
}

/** True when the user asked for reduced motion (animations become no-ops). */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Reparent the freshly-painted board pieces (still in `frag`) into a structured
 * battlefield grid: top bar, opponent area, center action lane, player area,
 * hand dock, and a log drawer. This is a pure DOM move — every element and its
 * already-wired handlers are the SAME node; nothing is rebuilt and no gameplay
 * logic is involved. CSS (.arena*) lays the regions out.
 */
function buildArena(frag: DocumentFragment): HTMLElement {
  const region = (cls: string): HTMLElement => {
    const d = document.createElement("div");
    d.className = cls;
    return d;
  };
  const grid = region("arena");
  const top = region("arena__top");
  const opp = region("arena__opp");
  const lane = region("arena__lane");
  const mine = region("arena__mine");
  const dock = region("arena__dock");

  const move = (parent: HTMLElement, sel: string): void => {
    const el = frag.querySelector<HTMLElement>(sel);
    if (el !== null) parent.append(el);
  };

  move(top, ".play-match__header");
  move(opp, ".play-match__zone--opponent");
  // Center lane = the phase/targeting/prompt area between the two fields.
  for (const sel of [
    ".play-match__phase",
    ".play-match__playback-banner",
    ".play-match__error",
    ".play-match__callout",
    ".play-match__hint",
    ".play-match__tutorial-hint",
  ]) {
    move(lane, sel);
  }
  move(mine, ".play-match__zone--mine");
  // Pinned action dock: attack/target prompts and the selected-card action bar
  // sit ABOVE the hand so their action buttons (Summon/Play/Equip/Attack) are
  // always visible — never clipped by the viewport-constrained layout.
  for (const p of Array.from(frag.querySelectorAll<HTMLElement>(".play-match__choice"))) {
    dock.append(p);
  }
  move(dock, ".play-match__selected");
  move(dock, ".play-match__zone--hand");

  grid.append(top, opp, lane, mine, dock);

  const log = frag.querySelector<HTMLElement>(".play-match__log");
  if (log !== null) {
    log.classList.add("arena__log");
    grid.append(log);
  }

  // Safety net: never drop a node if the board grows a new top-level piece.
  while (frag.firstChild !== null) grid.append(frag.firstChild);
  return grid;
}

/** True when an attack action resolves through a chosen Attack card. */
function hasAttackCard(action: GameAction): boolean {
  return action.kind === "attack" && action.selectedAttackCardId !== undefined;
}

/** The `attack` member of GameAction (the only kind carrying effectTargetInstanceId). */
type AttackAction = Extract<GameAction, { kind: "attack" }>;

/**
 * An optional secondary target a declared attack offers at declaration time,
 * carried on the attack's effectTargetInstanceId: Gylippus's extra enemy, Scythe
 * Cycle's splash enemy, or Moirai's other friendly Warrior. Returns the prompt
 * heading and the valid Warriors, or null when this attack needs no such pick.
 *
 * The single effectTargetInstanceId field can serve only one effect, so when
 * more than one applies (e.g. Scythe Cycle equipped while playing Gylippus —
 * both want a second enemy) the chosen Warrior is shared, and the rare
 * enemy-vs-friendly clash (Moirai + Gylippus) resolves to the first match.
 */
function secondaryAttackRequirement(
  state: GameState,
  variant: AttackAction,
): { heading: string; targets: WarriorInPlay[] } | null {
  const me = state.players[state.activePlayer];
  const card =
    variant.selectedAttackCardId !== undefined
      ? me.hand.find((c) => c.id === variant.selectedAttackCardId)
      : undefined;
  if (card !== undefined && isGylippusAttackCard(card)) {
    const targets = getGylippusSecondaryTargets(state, card, variant.defenderInstanceId);
    if (targets.length > 0) {
      return { heading: `${card.name}: deal extra damage to a second enemy Warrior`, targets };
    }
  }
  const splash = getScytheCycleSplashTargets(
    state,
    variant.attackerInstanceId,
    variant.defenderInstanceId,
  );
  if (splash.length > 0) {
    return { heading: "Scythe Cycle: splash an additional enemy Warrior", targets: splash };
  }
  const moirai = getMoiraiExtraAttackTargets(state, variant.attackerInstanceId);
  if (moirai.length > 0) {
    return { heading: "Moirai: grant another friendly Warrior an extra attack", targets: moirai };
  }
  return null;
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
  /**
   * Fired after every successful human action (once per action, before any
   * opponent playback animates). The mount uses it to persist the match's
   * action history for crash/refresh recovery. Omitted where recovery isn't
   * wired (e.g. pure tests).
   */
  readonly onAction?: () => void;
  /**
   * Fired when the player taps "Report issue" in the live match (Feature A). The
   * mount (account-view) opens the feedback modal and attaches a compact match
   * summary. Omitted in pure tests.
   */
  readonly onReportIssue?: () => void;
}

/**
 * The board element with a cleanup hook. Callers MUST call `dispose()` when the
 * board is unmounted or replaced, so a queued opponent-playback timer can't fire
 * after teardown and touch a gone document.
 */
export interface PlayableMatchBoard extends HTMLElement {
  /** Cancels any pending playback timer and stops further re-renders. Idempotent. */
  dispose(): void;
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
): PlayableMatchBoard {
  const root = document.createElement("section") as PlayableMatchBoard;
  root.className = "account play-match";
  // Faction accent hook for the arena styling (presentation only — the value is
  // the player's faction; CSS maps it to a glow color). No gameplay effect.
  root.dataset["faction"] = match.playerFaction;

  // Battle-log collapse state (drawer). UI-only; persists across paints. On
  // narrow screens (no room for the side-panel log) it starts collapsed so the
  // battlefield + hand own the viewport; on desktop the log is a side column.
  let logCollapsed =
    typeof window !== "undefined" && window.innerWidth < 1100;

  // Warm the browser cache for the opening hand + on-board art up front so
  // gameplay visuals appear immediately (optimized thumbnails only — the
  // full-size zoom image is never preloaded). Best-effort; no gameplay effect.
  if (!noArt()) {
    try {
      const s0 = match.state();
      preloadCardArt(
        [
          ...s0.players.player1.hand,
          ...s0.players.player1.field.map((w) => w.card),
          ...s0.players.player2.field.map((w) => w.card),
        ],
        LIVE_ART_BASE,
      );
    } catch {
      /* preload is best-effort */
    }
  }

  // Stability switches (Feature B/C), read once. All default off; desktop is
  // unaffected unless a flag is set. Each isolates one suspected reload cause.
  const flags = {
    noAnim: noAnim(),
    noArt: noArt(),
    noPlayback: noPlayback(),
  };
  // Cap the rendered battle log harder on low-power/safe mode (25 vs 60).
  const logCap = renderedLogCap();
  const cacheCap = artCacheCap();
  // Reuse card-art nodes across repaints instead of recreating (and re-decoding)
  // them every frame — the dominant mobile memory pressure. Keyed by tile
  // identity, capped at `cacheCap`, evicting the oldest (insertion order).
  const artCache = new Map<string, HTMLElement>();

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
  // A two-target duel Item (Trial of Gia) mid-selection: friendly first, then enemy.
  let pendingDuel: { cardId: string; friendly: string | null } | null = null;
  // A declared attack whose attacker/Attack card offers an optional secondary
  // target (Gylippus, Scythe Cycle, Moirai), awaiting the player's choice.
  let pendingSecondary: { variant: AttackAction } | null = null;
  // Feature B: the card/Warrior the player has tapped to inspect-and-act. Its
  // actions surface in a dedicated selected-card panel (see paint()); per-card
  // buttons are otherwise de-cluttered (hidden via CSS). Cleared on every action.
  let selected:
    | { readonly kind: "hand"; readonly id: string }
    | { readonly kind: "field"; readonly id: string }
    | null = null;
  // Subject of the selected-card panel, captured while painting tiles each frame.
  let panelInfo: { title: string; sub: string; card: Card } | null = null;
  let error: string | null = null;
  let completed = false;

  // --- onboarding hints (Feature D) ----------------------------------------
  // Lightweight contextual hints. Hidden permanently via the tutorial flag
  // ("Don't show again") or for this session via "Got it".
  const tutorialStore = getTutorialStore();
  let hintsHidden = isTutorialDismissed(tutorialStore, "liveHints");

  // --- playback (opponent turn) + floating-text state ----------------------
  // True once the board is disposed (unmounted/replaced): every delayed callback
  // and paint bails, so nothing touches the DOM after teardown.
  let disposed = false;
  // Handle for the pending default-scheduler timer, so dispose() can cancel it.
  // (An injected scheduler manages its own timing; nothing real is left here.)
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const schedule: PlaybackScheduler =
    options.scheduler ??
    ((cb, ms) => {
      pendingTimer = setTimeout(cb, ms);
    });
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
    pendingDuel = null;
    pendingSecondary = null;
    selected = null;
  };

  // Feature B: tap a hand card / field Warrior to select it (toggles off when
  // tapping the same one). Ignored while the opponent's turn is playing back.
  const selectThing = (sel: { kind: "hand" | "field"; id: string }): void => {
    if (playback !== null) return;
    selected =
      selected !== null && selected.kind === sel.kind && selected.id === sel.id
        ? null
        : sel;
    error = null;
    paint();
  };

  // --- game-feel: animation events (Feature C/D/E/F) ------------------------
  // Fire a named moment so a sound layer can subscribe later (Feature F). The
  // event is dispatched on the board root; tests assert these are queued.
  const emitAnim = (detail: MatchAnimDetail): void => {
    root.dispatchEvent(new CustomEvent<MatchAnimDetail>(MATCH_ANIM_EVENT, { detail }));
  };

  // Find a Warrior tile / a player's life area in the freshly-painted board.
  const tileOf = (instanceId: string | undefined): HTMLElement | null =>
    instanceId === undefined
      ? null
      : root.querySelector<HTMLElement>(`[data-instance="${instanceId}"]`);
  const seatOf = (player: string | undefined): HTMLElement | null =>
    player === undefined
      ? null
      : root.querySelector<HTMLElement>(`[data-seat="${player}"]`);

  // Translate-from-A-to-B vector for a lunge, in the board's coordinate space.
  const lungeVector = (from: Element, to: Element): { x: number; y: number } => {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    return { x: (b.left - a.left) * 0.4, y: (b.top - a.top) * 0.4 };
  };

  // Draw a short-lived beam from attacker to target (Feature D.2). DOM + WAAPI,
  // guarded; a no-op without layout (jsdom), under reduced motion, or no-anim.
  const drawBeam = (from: Element, to: Element): void => {
    if (flags.noAnim || prefersReducedMotion()) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - rootBox.left;
    const y1 = a.top + a.height / 2 - rootBox.top;
    const x2 = b.left + b.width / 2 - rootBox.left;
    const y2 = b.top + b.height / 2 - rootBox.top;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!Number.isFinite(len) || len === 0) return;
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    // Never let beams pile up: only one is ever on the board at a time.
    root.querySelectorAll(".play-match__beam").forEach((b) => b.remove());
    const beam = document.createElement("div");
    beam.className = "play-match__beam";
    beam.style.left = `${x1}px`;
    beam.style.top = `${y1}px`;
    beam.style.width = `${len}px`;
    beam.style.transform = `rotate(${angle}deg)`;
    root.append(beam);
    const anim = playAnim(beam, [{ opacity: 0.9 }, { opacity: 0 }], {
      duration: 360,
      easing: "ease-out",
    });
    if (anim) anim.addEventListener("finish", () => beam.remove());
    else beam.remove();
  };

  // Apply the visual effect + sound-ready event for one playback step. Called
  // after the board is painted for that step so anchors exist. Reduced-motion
  // and jsdom degrade gracefully (the event still fires; the motion is skipped).
  const applyStepEffects = (step: PlaybackStep): void => {
    emitAnim({
      kind: step.anim,
      actor: step.actor,
      targetInstanceId: step.targetInstanceId,
      targetPlayer: step.targetPlayer,
    });
    // The sound-ready event always fires; the visual motion is suppressed under
    // no-anim / reduced-motion so we can isolate animation as a reload cause.
    if (flags.noAnim || prefersReducedMotion()) return;
    const target = tileOf(step.targetInstanceId);
    switch (step.anim) {
      case "attack": {
        const attacker = tileOf(step.attackerInstanceId);
        if (attacker && target) {
          const v = lungeVector(attacker, target);
          playAnim(
            attacker,
            [
              { transform: "translate(0,0)" },
              { transform: `translate(${v.x}px, ${v.y}px)` },
              { transform: "translate(0,0)" },
            ],
            { duration: 380, easing: "ease-in-out" },
          );
          drawBeam(attacker, target);
        }
        playAnim(
          target,
          [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
          { duration: 260, easing: "ease-in-out" },
        );
        break;
      }
      case "damage":
      case "debuff":
        playAnim(
          target,
          [{ filter: "brightness(2)" }, { filter: "brightness(1)" }],
          { duration: 320 },
        );
        break;
      case "heal":
      case "buff":
      case "revive":
        playAnim(
          target,
          [{ filter: "brightness(0.6)" }, { filter: "brightness(1.4)" }, { filter: "brightness(1)" }],
          { duration: 380 },
        );
        break;
      case "destroy":
        playAnim(
          target,
          [
            { opacity: 1, transform: "scale(1) rotate(0deg)" },
            { opacity: 0, transform: "scale(0.7) rotate(6deg)" },
          ],
          { duration: 420, easing: "ease-in" },
        );
        break;
      case "summon":
        playAnim(
          target,
          [{ opacity: 0, transform: "translateY(10px) scale(0.9)" }, { opacity: 1, transform: "none" }],
          { duration: 320, easing: "ease-out" },
        );
        break;
      case "directAttack":
        playAnim(
          seatOf(step.targetPlayer),
          [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.08)", filter: "brightness(1.8)" }, { transform: "scale(1)", filter: "brightness(1)" }],
          { duration: 420, easing: "ease-out" },
        );
        break;
      default:
        break;
    }
  };

  const startPlayback = (steps: PlaybackStep[]): void => {
    playback = { steps, index: 0 };
    paint();
    // Animate + emit the first step's moment now that its snapshot is painted.
    applyStepEffects(steps[0]!);
    scheduleNext();
  };

  const scheduleNext = (): void => {
    if (playback === null || disposed) return;
    const step = playback.steps[playback.index]!;
    schedule(() => {
      // The board may have been disposed (unmounted) while this was queued.
      if (disposed || playback === null) return;
      playback.index += 1;
      if (playback.index >= playback.steps.length) {
        playback = null;
        callout = null;
        floaters = [];
        paint();
      } else {
        paint();
        applyStepEffects(playback.steps[playback.index]!);
        scheduleNext();
      }
    }, options.stepDelayMs ?? step.durationMs);
  };

  // Cleanup hook: cancel the pending playback timer and stop further re-renders.
  // Idempotent — safe to call more than once, e.g. quit then navigate away.
  const dispose = (): void => {
    disposed = true;
    playback = null;
    floaters = [];
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    // Drop any transient overlay nodes (e.g. an in-flight attack beam) and cancel
    // any running keyframe animations so nothing is left animating against a
    // detached board (Part D: bound live timers/animations/DOM on teardown).
    root.querySelectorAll(".play-match__beam").forEach((b) => b.remove());
    const all = root as HTMLElement & { getAnimations?: () => Animation[] };
    if (typeof all.getAnimations === "function") {
      try {
        for (const a of root.querySelectorAll("*")) {
          const el = a as HTMLElement & { getAnimations?: () => Animation[] };
          el.getAnimations?.().forEach((anim) => anim.cancel());
        }
      } catch {
        /* getAnimations unsupported — nothing to cancel */
      }
    }
    artCache.clear();
    setMetricsProvider(null);
    setMatchActive(false);
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
    // Persist the move for crash/refresh recovery before any playback animates.
    actions.onAction?.();
    const steps = toPlaybackSteps(res.frames);
    const passedTurn = res.frames.some((f) => f.actor === "opponent");
    if (passedTurn && steps.length > 0 && flags.noPlayback) {
      // No-playback isolation mode: skip the step-by-step animation entirely.
      // Jump to the final state with one summary callout, still emitting the
      // sound-ready events so nothing downstream changes — just no timed queue.
      floaters = [];
      callout = steps[steps.length - 1]!.message;
      paint();
      for (const step of steps) applyStepEffects(step);
    } else if (passedTurn && steps.length > 0) {
      // The turn passed to the AI: play the whole reply back, locked.
      floaters = [];
      startPlayback(steps);
    } else {
      // Still the player's turn: immediate floating feedback, no lock.
      floaters = steps.filter((s) => s.floatingText !== undefined);
      callout = steps.length > 0 ? steps[steps.length - 1]!.message : null;
      paint();
      // Animate + emit each resolved moment now that the board is painted.
      for (const step of steps) applyStepEffects(step);
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
    // A labelled stat chip; the aria-label spells the value out for screen readers.
    const chip = (
      cls: string,
      glyph: string,
      value: number,
      noun: string,
    ): string =>
      `<span class="play-match__stat ${cls}" title="${escapeHtml(noun)}" ` +
      `aria-label="${value} ${escapeHtml(noun)}">${glyph} ${value}</span>`;
    el.innerHTML =
      `<span class="play-match__seat">${escapeHtml(label)}</span>` +
      chip("play-match__stat--lives", "♥", p.lives, "Lives") +
      chip("play-match__stat--spirit", "◆", p.spirit, "Spirit") +
      chip("play-match__stat--hand", "✋", p.hand.length, "cards in hand") +
      chip("play-match__stat--deck", "🂠", p.deck.length, "cards in deck") +
      chip("play-match__stat--out", "⚰", p.outDeck.length, "cards in Out Deck");
    return el;
  };

  // Opens the shared card-detail modal for `card`, when an inspector is wired.
  const inspect = (card: Card): void => actions.onInspect?.(card);

  // The card visual for a live tile, reused across repaints via `artCache` (keyed
  // by tile identity) so the same decoded node is moved into each new frame rather
  // than recreated/re-decoded — the key mobile-memory fix. In no-art mode it's a
  // lightweight text placeholder (no <img>, no decode) to isolate image pressure.
  // The cache is capped (oldest evicted) so it can't grow unbounded.
  const cardArt = (card: Card, key: string): HTMLElement => {
    const cached = artCache.get(key);
    if (cached !== undefined) return cached;
    let node: HTMLElement;
    if (flags.noArt) {
      const ph = document.createElement("div");
      ph.className = "play-match__art play-match__art--placeholder";
      ph.textContent = card.name.slice(0, 2).toUpperCase();
      ph.setAttribute("aria-hidden", "true");
      node = ph;
    } else {
      const img = document.createElement("img");
      img.className = "play-match__art";
      img.alt = "";
      // Match cards are all immediately relevant (opening hand + battlefield), so
      // load eagerly — never defer gameplay visibility. Thumbnails are ~30–80 KB.
      img.loading = "eager";
      img.decoding = "async";
      img.src = cardThumbUrl(card, LIVE_ART_BASE);
      img.addEventListener("error", () => {
        if (img.dataset["fallback"] === undefined) {
          img.dataset["fallback"] = "1";
          img.src = cardImageUrl(card, LIVE_ART_BASE);
          return;
        }
        img.removeAttribute("src");
        img.classList.add("play-match__art--missing");
      });
      node = img;
    }
    // Cap the cache: evict the oldest entry once over the limit.
    while (artCache.size >= cacheCap) {
      const oldest = artCache.keys().next().value;
      if (oldest === undefined) break;
      artCache.delete(oldest);
    }
    artCache.set(key, node);
    return node;
  };

  // Short status chips for a live Warrior (tank form, foreign control, a
  // temporary ATK buff). Pure read of the WarriorInPlay; empty when none apply.
  const warriorStatusChips = (w: WarriorInPlay): string[] => {
    const chips: string[] = [];
    if (w.tankForm !== undefined) chips.push("🛡 Tank");
    if (w.stolenFrom !== undefined) chips.push("⤴ Stolen");
    if (w.temporaryAttackBuffs.length > 0) chips.push("▲ Buffed");
    return chips;
  };

  // A Warrior tile (Feature A): the full card art is the tile; compact ATK/HP
  // overlay stats sit on the art, and a small inspect button opens the detail
  // modal. Tapping the tile SELECTS the Warrior (Feature B) — its actions then
  // surface in the selected-card panel. Action buttons still live on the tile
  // (used by target-reveal and the panel) but are de-cluttered via CSS.
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
      (opts.highlighted ? " play-match__warrior--target" : "") +
      (selected?.kind === "field" && selected.id === w.instanceId
        ? " play-match__warrior--picked"
        : "");
    el.dataset.instance = w.instanceId; // anchor for floating combat text + animation
    el.addEventListener("click", () => selectThing({ kind: "field", id: w.instanceId }));
    if (selected?.kind === "field" && selected.id === w.instanceId) {
      panelInfo = {
        title: w.card.name,
        sub: `⚔${w.currentAttack} · ♥${w.currentHealth}`,
        card: w.card,
      };
    }

    const face = document.createElement("div");
    face.className = "play-match__warrior-face";

    // The art region (art + ATK/HP overlay + the corner inspect button). Keeping
    // the inspect button in here anchors it to the bottom-right of the IMAGE, so
    // it never covers the top stat overlay nor the name/controls below.
    const artWrap = document.createElement("div");
    artWrap.className = "play-match__art-wrap";
    artWrap.append(cardArt(w.card, `field:${w.instanceId}`));
    const overlay = document.createElement("span");
    overlay.className = "play-match__warrior-overlay";
    overlay.innerHTML =
      `<span class="play-match__overlay-atk" title="Attack">⚔${w.currentAttack}</span>` +
      `<span class="play-match__overlay-hp" title="Health">♥${w.currentHealth}</span>`;
    artWrap.append(overlay);

    // Small dedicated inspect affordance (the detail modal stays one tap away),
    // pinned to the bottom-right of the art.
    const insp = document.createElement("button");
    insp.type = "button";
    insp.className = "play-match__warrior-inspect";
    insp.title = "View card details";
    insp.setAttribute("aria-label", `Inspect ${w.card.name}`);
    insp.textContent = "🔍";
    insp.addEventListener("click", (e) => {
      e.stopPropagation();
      inspect(w.card);
    });
    artWrap.append(insp);
    face.append(artWrap);

    const statusChips = warriorStatusChips(w)
      .map((c) => `<span class="play-match__warrior-status">${escapeHtml(c)}</span>`)
      .join("");
    const info = document.createElement("span");
    info.className = "play-match__warrior-info";
    info.innerHTML =
      `<span class="play-match__warrior-name">${escapeHtml(w.card.name)}</span>` +
      `<span class="play-match__warrior-stats" title="Attack / Health">` +
      `⚔${w.currentAttack} · ♥${w.currentHealth}</span>` +
      `<span class="play-match__warrior-meta" title="Attacks remaining">⚡${w.attacksRemaining}</span>` +
      (statusChips ? `<span class="play-match__warrior-statuses">${statusChips}</span>` : "") +
      (opts.badge ? `<span class="play-match__warrior-badge">${escapeHtml(opts.badge)}</span>` : "");
    face.append(info);
    el.append(face);

    if (w.attachedWeapon !== undefined) {
      const weapon = w.attachedWeapon;
      const weaponBtn = document.createElement("button");
      weaponBtn.type = "button";
      weaponBtn.className = "play-match__weapon-inspect";
      weaponBtn.title = "View Weapon details";
      weaponBtn.textContent = `⚔ ${weapon.name}`;
      weaponBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        inspect(weapon);
      });
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

  // A small gameplay-action button shown on a Warrior tile. Stops propagation so
  // acting never also re-selects the tile (Feature B).
  const warriorBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__warrior-btn";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
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

  // Dispatch a chosen attack variant. If it offers an optional secondary target
  // (Gylippus / Scythe Cycle / Moirai), open the secondary-target picker first;
  // otherwise resolve the attack immediately. Used by every attack entry point.
  const dispatchAttack = (variant: GameAction): void => {
    if (
      variant.kind === "attack" &&
      secondaryAttackRequirement(match.state(), variant) !== null
    ) {
      pendingSecondary = { variant };
      pendingAttack = null;
      error = null;
      paint();
      return;
    }
    act(variant);
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
      panel.append(choiceBtn("Regular attack (no card)", () => dispatchAttack(regular)));
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
          () => dispatchAttack(variant),
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

  // Optional secondary-target picker for a declared attack (Gylippus extra
  // enemy, Scythe Cycle splash, Moirai's other friendly Warrior). Lists each
  // valid Warrior (inspectable) plus a Skip option that attacks with no
  // secondary target, and Cancel that aborts without attacking.
  const secondaryTargetPanel = (): HTMLElement | null => {
    if (pendingSecondary === null) return null;
    const variant = pendingSecondary.variant;
    const req = secondaryAttackRequirement(match.state(), variant);
    if (req === null) return null; // state moved on; nothing to pick

    const panel = document.createElement("section");
    panel.className = "account__panel play-match__choice";
    const h = document.createElement("h3");
    h.className = "account__panel-heading";
    h.textContent = req.heading;
    panel.append(h);

    for (const target of req.targets) {
      const row = document.createElement("div");
      row.className = "play-match__choice-option";
      const look = document.createElement("button");
      look.type = "button";
      look.className = "play-match__card-inspect";
      look.title = "View card details";
      look.innerHTML =
        `<span class="play-match__card-name">${escapeHtml(target.card.name)}</span>` +
        `<span class="play-match__card-meta">${escapeHtml(target.card.faction)} · ` +
        `${escapeHtml(target.card.type)}</span>`;
      look.addEventListener("click", () => inspect(target.card));
      row.append(look);
      row.append(
        choiceBtn(`Target ${target.card.name}`, () =>
          act({ ...variant, effectTargetInstanceId: target.instanceId }),
        ),
      );
      panel.append(row);
    }
    panel.append(choiceBtn("Skip (attack without it)", () => act(variant)));
    panel.append(
      cancelRow(() => {
        // Back out without attacking: keep the attacker selected so the player
        // can re-declare. No Attack card is spent and no attack resolves.
        pendingSecondary = null;
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

  // The dedicated selected-card action panel (Feature B). Shows the tapped card
  // big, an Inspect button, and that card's available actions WITH disabled
  // reasons. The action buttons are the very same nodes built on the tile (with
  // all their wired flows) — moved here — so every manual flow keeps working and
  // nothing is duplicated. `controls` is the tile's controls node, or null.
  const selectedCardPanel = (
    info: { title: string; sub: string; card: Card },
    controls: HTMLElement | null,
  ): HTMLElement => {
    const panel = document.createElement("section");
    // Compact command strip (not a large card panel): a single horizontal line
    // pinned in the dock, so it never consumes field space or hides the hand /
    // Enter Battle / End Turn (see .arena__command in match-arena.css).
    panel.className = "account__panel play-match__selected arena__command";

    const head = document.createElement("div");
    head.className = "play-match__selected-head";
    head.append(cardArt(info.card, `sel:${info.card.id}`));
    const meta = document.createElement("div");
    meta.className = "play-match__selected-meta";
    meta.innerHTML =
      `<h3 class="account__panel-heading play-match__selected-title">${escapeHtml(info.title)}</h3>` +
      `<p class="play-match__selected-sub">${escapeHtml(info.sub)}</p>`;
    head.append(meta);
    panel.append(head);

    const actions = document.createElement("div");
    actions.className = "play-match__selected-actions";
    const inspectBtn = document.createElement("button");
    inspectBtn.type = "button";
    inspectBtn.className = "play-match__selected-inspect";
    inspectBtn.textContent = "Inspect";
    inspectBtn.addEventListener("click", () => inspect(info.card));
    actions.append(inspectBtn);
    if (controls !== null && controls.children.length > 0) {
      actions.append(controls); // moves the tile's wired action buttons here
    } else {
      const none = document.createElement("p");
      none.className = "play-match__selected-none";
      none.textContent = "No actions available right now.";
      actions.append(none);
    }
    // Cancel/Deselect — clears the selection and resets the action bar. UI only.
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "play-match__selected-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      selected = null;
      paint();
    });
    actions.append(cancelBtn);
    panel.append(actions);
    return panel;
  };

  // --- the painter ----------------------------------------------------------
  function paint(): void {
    // Disposed: the board is unmounted; never build DOM (the document may be gone).
    if (disposed) return;
    panelInfo = null; // re-captured while painting the tiles this frame
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

    // Locked while the opponent's turn animates: dims the board (CSS) so the
    // input-lock is unmistakable (Feature E).
    root.classList.toggle("play-match--locked", playing);

    // A labelled battlefield/hand zone (Feature A): a caption plus its children,
    // so opponent / player / hand read as distinct areas.
    const zone = (
      label: string,
      modifier: string,
      ...kids: (HTMLElement | null)[]
    ): HTMLElement => {
      const z = document.createElement("section");
      z.className = `play-match__zone play-match__zone--${modifier}`;
      const cap = document.createElement("p");
      cap.className = "play-match__zone-label";
      cap.textContent = label;
      z.append(cap);
      for (const k of kids) if (k !== null) z.append(k);
      return z;
    };

    // Header: title + concede.
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
    if (actions.onReportIssue !== undefined) {
      const report = document.createElement("button");
      report.type = "button";
      report.className = "account__signout play-match__report";
      report.textContent = "Report issue";
      report.addEventListener("click", actions.onReportIssue);
      header.append(report);
    }
    frag.append(header);

    // Prominent turn/phase banner (Feature E): names what's expected of the
    // player — their move, opponent acting, or a specific choice in progress.
    const choosing =
      pendingRevive !== null ||
      pendingSearch !== null ||
      pendingSteal !== null ||
      pendingItemTarget !== null ||
      pendingDuel !== null ||
      pendingWeapon !== null;
    let phaseState: string;
    let phaseTone: string;
    if (playing) {
      phaseState = "Opponent is acting";
      phaseTone = "playback";
    } else if (pendingAttack !== null) {
      phaseState = "Choose an Attack card";
      phaseTone = "choose";
    } else if (pendingSecondary !== null) {
      phaseState = "Choose a secondary target";
      phaseTone = "choose";
    } else if (choosing) {
      phaseState = "Choose a target";
      phaseTone = "choose";
    } else if (!yourTurn) {
      phaseState = "Opponent's turn";
      phaseTone = "opponent";
    } else {
      phaseState = "Your move";
      phaseTone = "you";
    }
    const phaseName = state.phase === "battle" ? "Battle" : "Main";
    const phaseBanner = document.createElement("div");
    phaseBanner.className = `play-match__phase play-match__phase--${phaseTone}`;
    phaseBanner.setAttribute("role", "status");
    phaseBanner.setAttribute("aria-live", "polite");
    phaseBanner.innerHTML =
      `<span class="play-match__phase-state">${escapeHtml(phaseState)}</span>` +
      `<span class="play-match__phase-sub">Turn ${state.turn} — ${phaseName} phase</span>`;
    frag.append(phaseBanner);

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
    // calloutEl is appended between the two fields below (Feature A/E).

    if (error !== null) {
      const err = document.createElement("p");
      err.className = "play-match__error";
      err.textContent = error;
      frag.append(err);
    }

    const hint = document.createElement("p");
    hint.className = "play-match__hint";
    hint.textContent =
      "Tap a card to select it and see its actions; use 🔍 for full details.";
    frag.append(hint);

    // Contextual onboarding hint (Feature D): main/battle/attack-card guidance,
    // shown until the player hides it. Never shown during opponent playback.
    if (!hintsHidden && !playing) {
      let hintText: string;
      if (pendingAttack !== null) {
        hintText = "Attack cards can replace a regular attack when compatible.";
      } else if (state.phase === "battle") {
        hintText =
          "Attack enemy Warriors. Direct attacks reduce Lives when the opponent " +
          "has no Warriors.";
      } else {
        hintText = "Summon Warriors and play Items or Weapons.";
      }
      const tip = document.createElement("div");
      tip.className = "play-match__tutorial-hint";
      tip.setAttribute("role", "note");
      const tipText = document.createElement("span");
      tipText.className = "play-match__tutorial-hint-text";
      tipText.textContent = hintText;
      const gotIt = document.createElement("button");
      gotIt.type = "button";
      gotIt.className = "play-match__tutorial-hint-got";
      gotIt.textContent = "Got it";
      gotIt.addEventListener("click", () => {
        hintsHidden = true; // session-only: returns next match
        paint();
      });
      const never = document.createElement("button");
      never.type = "button";
      never.className = "play-match__tutorial-hint-never";
      never.textContent = "Don't show again";
      never.addEventListener("click", () => {
        dismissTutorial(tutorialStore, "liveHints");
        hintsHidden = true;
        paint();
      });
      tip.append(tipText, gotIt, never);
      frag.append(tip);
    }

    // Opponent zone: their stats + field (Feature A/C).
    frag.append(
      zone("Opponent", "opponent", statBar("Opponent", opp), fieldRow(opp, false, idx)),
    );

    // Current-action callout, between the two fields where the eye lands.
    frag.append(calloutEl);

    // Player zone: your field + stats.
    frag.append(
      zone("You", "mine", fieldRow(me, true, idx), statBar("You", me)),
    );

    // Pending choice prompts (player-only; never during playback).
    if (!playing) {
      const attackPanel = attackChoicePanel(idx, me);
      if (attackPanel !== null) frag.append(attackPanel);
      const secondaryPanel = secondaryTargetPanel();
      if (secondaryPanel !== null) frag.append(secondaryPanel);
      const revivePanel = reviveChoicePanel(state, me);
      if (revivePanel !== null) frag.append(revivePanel);
      const searchPanel = deckSearchChoicePanel(state, me);
      if (searchPanel !== null) frag.append(searchPanel);
      const stealPanel = stealChoicePanel(state, me);
      if (stealPanel !== null) frag.append(stealPanel);
    }

    // Hand zone (visually distinct from the field) + the action bar.
    const bar = document.createElement("div");
    bar.className = "play-match__actionbar";
    bar.append(
      barButton("Enter Battle", idx.enterBattle, "play-match__enter"),
      barButton("End Turn", idx.endTurn, "play-match__end"),
    );
    const handZone = zone("Your hand", "hand", handRow(me, idx), bar);

    // Selected-card action panel (Feature B), shown just above the hand when the
    // player has tapped a card/Warrior they can act on. We relocate that tile's
    // action buttons into the panel — the same wired nodes, so flows are intact.
    if (!playing && selected !== null && panelInfo !== null) {
      const containerSel =
        selected.kind === "hand"
          ? `[data-card-id="${selected.id}"]`
          : `[data-instance="${selected.id}"]`;
      const controlsSel =
        selected.kind === "hand"
          ? ".play-match__card-controls"
          : ".play-match__warrior-controls";
      // Hand tiles live in handZone (not yet appended); field tiles in frag.
      const scope: ParentNode = selected.kind === "hand" ? handZone : frag;
      const sourceEl = scope.querySelector<HTMLElement>(containerSel);
      const controls = sourceEl?.querySelector<HTMLElement>(controlsSel) ?? null;
      frag.append(selectedCardPanel(panelInfo, controls));
    } else if (selected !== null && panelInfo === null && !playing) {
      // The selected card/Warrior is gone (e.g. it resolved): drop the selection.
      selected = null;
    }

    frag.append(handZone);

    // Battle log (full history).
    frag.append(logPanel(state));

    // Floating combat text overlays, anchored to their target if visible.
    const activeFloaters = step
      ? step.floatingText !== undefined
        ? [step]
        : []
      : floaters;
    renderFloaters(frag, activeFloaters);

    // Battlefield layout (Phase 2): reparent the freshly-built pieces into a
    // structured arena grid — top bar, opponent area, center action lane, player
    // area, hand dock, and log drawer. Presentation only: every element (and its
    // wired handlers) is the SAME node, moved into a region, not rebuilt.
    root.replaceChildren(buildArena(frag));

    // Prune cached art for tiles no longer in play, so the cache can't grow
    // unbounded over a long match (it tracks only on-screen cards/Warriors).
    if (artCache.size > 0) {
      const live = new Set<string>();
      for (const seat of [me, opp]) {
        for (const w of seat.field) live.add(`field:${w.instanceId}`);
      }
      for (const c of me.hand) live.add(`hand:${c.id}`);
      // The selected-card panel keeps its own art node (it can't share the tile's
      // node, which is elsewhere in the DOM), so keep its key live too.
      const sel = selected;
      if (sel?.kind === "hand") {
        live.add(`sel:${sel.id}`);
      } else if (sel?.kind === "field") {
        const w =
          me.field.find((x) => x.instanceId === sel.id) ??
          opp.field.find((x) => x.instanceId === sel.id);
        if (w !== undefined) live.add(`sel:${w.card.id}`);
      }
      for (const key of artCache.keys()) {
        if (!live.has(key)) artCache.delete(key);
      }
    }

    // Debug-only: record growth counters so a mobile reload can be correlated
    // with state/DOM/timer size (no-op unless the debug flag is set).
    recordMatchMetrics(collectMetrics(state.turn, state.events.length, activeFloaters.length));
  }

  // Snapshot of live counters the debug panel pulls (also recorded each paint).
  // Centralized so the panel and the per-paint record never drift.
  const collectMetrics = (
    turn: number,
    events: number,
    floaterCount: number,
  ): Record<string, number> => ({
    turn,
    events,
    logRows: root.querySelectorAll(".play-match__log-entry, .play-match__log-turn").length,
    artNodes: artCache.size,
    imageNodes: root.querySelectorAll("img.play-match__art").length,
    floaters: floaterCount,
    beams: root.querySelectorAll(".play-match__beam").length,
    playbackQueue: playback ? playback.steps.length - playback.index : 0,
    pendingTimers: pendingTimer !== undefined ? 1 : 0,
    domNodes: root.querySelectorAll("*").length,
  });

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
    if (action !== undefined) {
      b.addEventListener("click", () => act(action));
    } else {
      // Disabled: Enter Battle is Main-phase only; End Turn needs your turn.
      const reason = cls.includes("enter")
        ? "Enter Battle — available in the Main phase"
        : cls.includes("end")
          ? "End Turn — available on your turn"
          : `${label} unavailable`;
      b.title = reason;
      b.setAttribute("aria-label", reason);
    }
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
        // Trial of Gia, step 1: pick a friendly Warrior (before the enemy).
        const duelCard =
          pendingDuel !== null
            ? player.hand.find((c) => c.id === pendingDuel!.cardId)
            : undefined;
        const isDuelAlly =
          duelCard !== undefined &&
          getForcedDuelFriendlyTargets(match.state(), duelCard).some(
            (t) => t.instanceId === w.instanceId,
          );
        const duelAllyChosen = pendingDuel?.friendly === w.instanceId;
        if (isDuelAlly && pendingDuel!.friendly === null) {
          controls.push(
            warriorBtn("Choose ally", () => {
              pendingDuel = { cardId: pendingDuel!.cardId, friendly: w.instanceId };
              error = null;
              paint();
            }),
          );
        } else if (duelAllyChosen) {
          controls.push(
            warriorBtn("✓ Ally — cancel", () => {
              pendingDuel = { cardId: pendingDuel!.cardId, friendly: null };
              error = null;
              paint();
            }),
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
            selected: selectedAttacker === w.instanceId || duelAllyChosen,
            highlighted: equipTarget !== undefined || isItemTarget || isDuelAlly,
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
        // An Item awaiting an enemy-Warrior target (Coerced Loyalty, Primetime
        // Interview): only Warriors the engine would accept get a pick.
        const active = match.state();
        const enemyItemCard =
          pendingItemTarget !== null
            ? active.players[active.activePlayer].hand.find((c) => c.id === pendingItemTarget)
            : undefined;
        const isEnemyItemTarget =
          enemyItemCard !== undefined &&
          getEnemyWarriorTargets(active, enemyItemCard).some(
            (t) => t.instanceId === w.instanceId,
          );
        const controls: HTMLButtonElement[] = [];
        if (variants !== undefined && variants.length > 0) {
          const attacker = selectedAttacker!;
          controls.push(
            warriorBtn("Attack", () => {
              // If any variant uses an Attack card, prompt to choose; otherwise
              // resolve the single regular attack (which may still open the
              // secondary-target picker, e.g. a Scythe Cycle / Moirai attacker).
              if (variants.some((a) => hasAttackCard(a))) {
                pendingAttack = { attacker, defender: w.instanceId };
                error = null;
                paint();
              } else {
                dispatchAttack(variants[0]!);
              }
            }),
          );
        }
        if (isEnemyItemTarget) {
          const cardId = enemyItemCard!.id;
          controls.push(
            warriorBtn("Target", () =>
              act({ kind: "playItem", cardId, targetInstanceId: w.instanceId }),
            ),
          );
        }
        // Trial of Gia, step 2: after an ally is chosen, pick the enemy duelist.
        const duelCard =
          pendingDuel !== null && pendingDuel.friendly !== null
            ? active.players[active.activePlayer].hand.find((c) => c.id === pendingDuel!.cardId)
            : undefined;
        const isDuelEnemy =
          duelCard !== undefined &&
          getForcedDuelEnemyTargets(active, duelCard).some(
            (t) => t.instanceId === w.instanceId,
          );
        if (isDuelEnemy) {
          const cardId = pendingDuel!.cardId;
          const friendly = pendingDuel!.friendly!;
          controls.push(
            warriorBtn("Duel here", () =>
              act({
                kind: "playItem",
                cardId,
                targetInstanceId: friendly,
                secondaryTargetInstanceId: w.instanceId,
              }),
            ),
          );
        }
        if (reclaim !== undefined) {
          controls.push(warriorBtn("Reclaim", () => act(reclaim)));
        }
        row.append(
          warriorEl(w, {
            highlighted:
              (variants !== undefined && variants.length > 0) || isEnemyItemTarget || isDuelEnemy,
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
      el.className =
        "play-match__card" +
        (selected?.kind === "hand" && selected.id === card.id
          ? " play-match__card--selected"
          : "");
      el.dataset.cardId = card.id;
      // Feature B: tapping the card selects it; its actions surface in the panel.
      el.addEventListener("click", () => selectThing({ kind: "hand", id: card.id }));
      if (selected?.kind === "hand" && selected.id === card.id) {
        panelInfo = {
          title: card.name + (copies > 1 ? ` ×${copies}` : ""),
          sub: `${card.type} · ◆${card.cost}`,
          card,
        };
      }

      // The card face is the full art + name/cost — the primary visual (Feature A).
      const face = document.createElement("div");
      face.className = "play-match__card-face";

      // Art region wraps the image + the corner inspect button, so the button
      // sits at the bottom-right of the IMAGE (clear of the name/cost below).
      const artWrap = document.createElement("div");
      artWrap.className = "play-match__art-wrap";
      artWrap.append(cardArt(card, `hand:${card.id}`));

      // Small dedicated inspect affordance (detail modal stays one tap away).
      const insp = document.createElement("button");
      insp.type = "button";
      insp.className = "play-match__card-inspect";
      insp.title = "View card details";
      insp.setAttribute("aria-label", `Inspect ${card.name}`);
      insp.textContent = "🔍";
      insp.addEventListener("click", (e) => {
        e.stopPropagation();
        inspect(card);
      });
      artWrap.append(insp);
      face.append(artWrap);

      const info = document.createElement("span");
      info.className = "play-match__card-info";
      info.innerHTML =
        `<span class="play-match__card-name">${escapeHtml(card.name)}` +
        `${copies > 1 ? ` ×${copies}` : ""}</span>` +
        `<span class="play-match__card-meta">${escapeHtml(card.type)} · ` +
        `◆${card.cost}</span>`;
      face.append(info);
      el.append(face);

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
      } else if (playItem !== undefined && isEnemyWarriorTargetItem(card)) {
        // Items that target an enemy Warrior (Coerced Loyalty, Primetime
        // Interview). Disable clearly when there is no valid enemy target.
        const targets = getEnemyWarriorTargets(match.state(), card);
        if (targets.length === 0) {
          controls.append(cardButton("No enemy Warrior to target", undefined));
        } else {
          const b = cardButton(
            pendingItemTarget === card.id ? "Pick an enemy…" : "Play",
            () => {
              pendingItemTarget = pendingItemTarget === card.id ? null : card.id;
              error = null;
              paint();
            },
          );
          if (pendingItemTarget === card.id) b.classList.add("play-match__card-btn--active");
          controls.append(b);
        }
      } else if (playItem !== undefined && isForcedDuelItem(card)) {
        // Trial of Gia needs a friendly AND an enemy Warrior (two-step pick).
        // Disabled unless at least one valid Warrior exists on each side.
        const allies = getForcedDuelFriendlyTargets(match.state(), card);
        const enemies = getForcedDuelEnemyTargets(match.state(), card);
        if (allies.length === 0 || enemies.length === 0) {
          controls.append(cardButton("Needs an ally and an enemy", undefined));
        } else {
          const active = pendingDuel?.cardId === card.id;
          const b = cardButton(
            active
              ? pendingDuel!.friendly === null
                ? "Choose your ally…"
                : "Choose an enemy…"
              : "Play",
            () => {
              pendingDuel = active ? null : { cardId: card.id, friendly: null };
              pendingItemTarget = null;
              error = null;
              paint();
            },
          );
          if (active) b.classList.add("play-match__card-btn--active");
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
    if (onClick !== undefined) {
      // Stop propagation so acting never also re-selects the parent card.
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
    } else {
      // Disabled: the label is the reason — expose it as a tooltip and to
      // screen readers so "why can't I?" is answerable on desktop and mobile.
      b.title = label;
      b.setAttribute("aria-label", `Unavailable: ${label}`);
    }
    return b;
  };

  const logPanel = (state: GameState): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "account__panel play-match__log";
    panel.classList.toggle("play-match__log--collapsed", logCollapsed);
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading play-match__log-head";
    heading.textContent = "Combat log";
    // Collapse/expand toggle (used as a drawer handle on mobile). UI only.
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "play-match__log-toggle";
    toggle.textContent = logCollapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", logCollapsed ? "false" : "true");
    toggle.addEventListener("click", () => {
      logCollapsed = !logCollapsed;
      paint();
    });
    heading.append(toggle);
    panel.append(heading);
    const ul = document.createElement("ul");
    ul.className = "play-match__log-list";
    const all = battleLogEntries(state);
    // Render only the most recent rows so the DOM stays bounded on long matches
    // (the full log is still available via battleLogLines / the saved history).
    // `logCap` is tighter on low-power/mobile devices.
    const entries = all.length > logCap ? all.slice(-logCap) : all;
    if (all.length === 0) {
      const li = document.createElement("li");
      li.className = "play-match__log-empty";
      li.textContent = "The match has begun.";
      ul.append(li);
    }
    if (all.length > entries.length) {
      const note = document.createElement("li");
      note.className = "play-match__log-truncated";
      note.textContent = `Showing the latest ${entries.length} of ${all.length} events.`;
      ul.append(note);
    }
    for (const entry of entries) {
      const li = document.createElement("li");
      // Turn dividers head each turn's block; action rows tint by who acted.
      li.className = entry.isTurnHeader
        ? "play-match__log-turn"
        : `play-match__log-entry play-match__log-entry--${entry.actor}`;
      li.textContent = entry.text;
      ul.append(li);
    }
    panel.append(ul);
    // Most recent entries at the bottom; keep them in view as the log grows.
    ul.scrollTop = ul.scrollHeight;
    return panel;
  };

  // Stability-mode marker classes (CSS kills float/beam motion under no-anim;
  // no-art tightens placeholder visuals). Only present when a flag is set.
  root.classList.toggle("play-match--no-anim", flags.noAnim);
  root.classList.toggle("play-match--no-art", flags.noArt);
  if (lowPowerActive()) root.classList.add("play-match--low-power");

  root.dispose = dispose;
  // Let the debug panel pull live counters on demand (cleared on dispose).
  setMetricsProvider(() =>
    collectMetrics(match.state().turn, match.state().events.length, floaters.length),
  );
  setMatchActive(true); // diagnostics marker: a live match is now on screen
  paint();
  return root;
}
