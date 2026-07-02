/**
 * Match FX layer (Phase B prototype of docs/design/ux-reboot.md) — decorative,
 * additive, and strictly presentation-only.
 *
 * Subscribes to the {@link MATCH_ANIM_EVENT} CustomEvents the board already
 * dispatches for every resolved moment (the seam built for a sound layer) and
 * spawns short-lived, CSS-animated energy nodes over the acting tiles. It
 * NEVER reads or writes game state, emits no events of its own, and touches no
 * callbacks — remove the attach call and the game is exactly as before.
 *
 * Lifecycle contract (matches the attack beam's): nodes are appended to the
 * board root, position:absolute, pointer-events:none, and self-remove after
 * their animation (the next full paint clears them at worst, since paint()
 * replaces the root's children). A hard cap bounds concurrent nodes so a busy
 * playback can never pile up DOM.
 *
 * Kill switches, in order: the euphoriaNoAnim / low-power debug flags disable
 * the layer entirely at attach; prefers-reduced-motion suppresses every spawn
 * at event time (the static selected/target glows in match-fx.css remain).
 *
 * Faction energy comes from the Phase A tokens (--eu-energy-*). All factions
 * get the base templates; Monk is the tuned reference (hotter, flame-accented
 * variants via the .match-fx--monk modifier) per the approved prototype scope.
 */
import {
  MATCH_ANIM_EVENT,
  type MatchAnimDetail,
} from "@euphoria/core/match-playback";
import { lowPowerActive, noAnim } from "./debug-flags";

/** Factions the energy tokens cover; anything else falls back to Neutral. */
const ENERGY_TOKENS: Record<string, string> = {
  Dwarf: "var(--eu-energy-dwarf)",
  Monk: "var(--eu-energy-monk)",
  Surfer: "var(--eu-energy-surfer)",
  Sonic: "var(--eu-energy-sonic)",
  Shaman: "var(--eu-energy-shaman)",
  Human: "var(--eu-energy-human)",
  Neutral: "var(--eu-energy-neutral)",
  Criminal: "var(--eu-energy-criminal)",
};

/** Never keep more than this many FX nodes alive at once. */
const MAX_LIVE_FX = 6;

/** Longest any node lives without its animation cleaning it up (ms). */
const LIFETIMES: Record<string, number> = {
  "match-fx--burst": 520,
  "match-fx--impact": 380,
  "match-fx--rise": 520,
  "match-fx--shatter": 460,
  "match-fx--turn": 560,
};

export interface MatchFxOptions {
  /** The viewer's faction (drives "player"-actor energy). */
  readonly playerFaction: string;
  /** The opposing faction (drives "opponent"-actor energy). */
  readonly opponentFaction: string;
}

/**
 * Attaches the FX layer to a rendered board and returns a detach function.
 * A no-op (returning a no-op) when animations are disabled via flags.
 */
export function attachMatchFx(
  board: HTMLElement,
  options: MatchFxOptions,
): () => void {
  if (noAnim() || lowPowerActive()) return () => {};

  let detached = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const reducedMotion = (): boolean => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false; // jsdom / very old browsers: treat as no preference
    }
  };

  const factionFor = (actor: MatchAnimDetail["actor"]): string =>
    actor === "player" ? options.playerFaction : options.opponentFaction;

  /**
   * Drops one ephemeral FX node centered on `anchor`. CSS keyframes run the
   * animation (they auto-start on insert and cost nothing in jsdom); the
   * timeout is only the janitor.
   */
  const spawn = (
    kindClass: keyof typeof LIFETIMES,
    anchor: Element | null,
    faction: string,
  ): void => {
    if (detached || anchor === null) return;
    if (board.querySelectorAll(".match-fx").length >= MAX_LIVE_FX) return;
    const el = document.createElement("div");
    // Every recognized faction stamps its modifier so CSS can skin the shared
    // template (Monk flame, Sonic streak, Criminal glitch, …). Unknown
    // factions get the base template in Neutral energy.
    const modifier =
      faction in ENERGY_TOKENS ? ` match-fx--${faction.toLowerCase()}` : "";
    el.className = `match-fx ${kindClass}${modifier}`;
    el.setAttribute("aria-hidden", "true");
    el.style.setProperty(
      "--fx-energy",
      ENERGY_TOKENS[faction] ?? ENERGY_TOKENS["Neutral"]!,
    );
    if (kindClass !== "match-fx--turn") {
      // Center on the anchor, in the board's coordinate space (beam pattern).
      const a = anchor.getBoundingClientRect();
      const b = board.getBoundingClientRect();
      el.style.left = `${a.left + a.width / 2 - b.left}px`;
      el.style.top = `${a.top + a.height / 2 - b.top}px`;
    }
    board.append(el);
    const timer = setTimeout(() => {
      el.remove();
      timers.delete(timer);
    }, LIFETIMES[kindClass]);
    timers.add(timer);
  };

  const tileOf = (instanceId: string | undefined): Element | null =>
    instanceId === undefined
      ? null
      : board.querySelector(`[data-instance="${instanceId}"]`);
  const seatOf = (player: string | undefined): Element | null =>
    player === undefined
      ? null
      : board.querySelector(`[data-seat="${player}"]`);

  // Dwarf signature: a short, small board shake on heavy hits. WAAPI with the
  // same guards as the view's playAnim (jsdom / old browsers: silent no-op),
  // throttled so back-to-back hits can't compound into judder. Decorative
  // only — it animates transform and always returns to identity.
  let lastShakeAt = 0;
  const microShake = (): void => {
    const now = Date.now();
    if (now - lastShakeAt < 400) return;
    lastShakeAt = now;
    try {
      board.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: "translate(3px, -2px)" },
          { transform: "translate(-3px, 2px)" },
          { transform: "translate(0, 0)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    } catch {
      /* Element.animate unavailable — skip the shake */
    }
  };

  const onAnim = (event: Event): void => {
    const detail = (event as CustomEvent<MatchAnimDetail>).detail;
    if (detail === undefined || detail === null || reducedMotion()) return;
    const faction = factionFor(detail.actor);
    const tile = tileOf(detail.targetInstanceId);
    switch (detail.kind) {
      case "summon":
        spawn("match-fx--burst", tile, faction);
        break;
      case "attack":
      case "damage":
        spawn("match-fx--impact", tile, faction);
        if (faction === "Dwarf") microShake();
        break;
      case "heal":
      case "buff":
      case "revive":
        spawn("match-fx--rise", tile, faction);
        break;
      case "destroy":
        spawn("match-fx--shatter", tile, faction);
        break;
      case "directAttack":
        spawn("match-fx--impact", seatOf(detail.targetPlayer), faction);
        if (faction === "Dwarf") microShake();
        break;
      default:
        break; // draw / play / equip / debuff / info: no decoration yet
    }
  };
  board.addEventListener(MATCH_ANIM_EVENT, onAnim);

  // ---- turn-change wipe ------------------------------------------------
  // paint() rebuilds the board with one replaceChildren per frame, so a
  // childList observer on the root fires once per paint — a cheap signal to
  // re-read the phase banner's tone. When it flips between "your move" and
  // "opponent acting", sweep a diagonal energy wipe in the NEW side's color.
  let lastTone: "you" | "opponent" | null = null;
  const readTone = (): "you" | "opponent" | null => {
    if (board.querySelector(".play-match__phase--you") !== null) return "you";
    if (
      board.querySelector(
        ".play-match__phase--opponent, .play-match__phase--playback",
      ) !== null
    ) {
      return "opponent";
    }
    return null;
  };
  const onPaint = (): void => {
    if (detached) return;
    const tone = readTone();
    if (
      tone !== null &&
      lastTone !== null &&
      tone !== lastTone &&
      !reducedMotion()
    ) {
      spawn(
        "match-fx--turn",
        board,
        factionFor(tone === "you" ? "player" : "opponent"),
      );
    }
    if (tone !== null) lastTone = tone;
  };
  const observer = new MutationObserver(onPaint);
  observer.observe(board, { childList: true });
  lastTone = readTone();

  return () => {
    detached = true;
    observer.disconnect();
    board.removeEventListener(MATCH_ANIM_EVENT, onAnim);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    board.querySelectorAll(".match-fx").forEach((el) => el.remove());
  };
}
