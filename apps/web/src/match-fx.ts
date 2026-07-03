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
 * Kill switches, in order: the euphoriaNoAnim / low-power / safe-mode flags
 * disable the layer entirely at attach; prefers-reduced-motion is checked per
 * moment — it suppresses every decorative spawn (the static selected/target
 * glows in match-fx.css remain) and swaps the attack-card super-move for its
 * calm "lite" presentation.
 *
 * Faction energy comes from the Phase A tokens (--eu-energy-*). All factions
 * get the base templates; Monk is the tuned reference (hotter, flame-accented
 * variants via the .match-fx--monk modifier) per the approved prototype scope.
 */
import {
  MATCH_ANIM_EVENT,
  type MatchAnimDetail,
} from "@euphoria/core/match-playback";
import { FLAG_LOW_POWER, FLAG_NO_ANIM, flag, safeMode } from "./debug-flags";

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

/**
 * View-level CustomEvent announcing "this attack was powered by an Attack
 * card" — dispatched by the board (play-match-view) at the attack's visual
 * moment, rendered here as the super-move cinematic. Like MATCH_ANIM_EVENT it
 * always fires (a sound layer may want it); only the visuals are gated.
 */
export const ATTACK_CARD_FX_EVENT = "euphoria:attack-card-fx";

/** Detail payload of {@link ATTACK_CARD_FX_EVENT}. */
export interface AttackCardFxDetail {
  readonly cardName: string;
  /** Optimized card art; absent under the no-art flag (text face instead). */
  readonly artUrl?: string;
  readonly actor: "player" | "opponent";
  /** The defender's tile, for the impact cue at the slam moment. */
  readonly targetInstanceId?: string;
}

/**
 * Super-move pacing. The cinematic is two phases:
 *  1. REVEAL — the card pops in on the actor's side and HOLDS while its art
 *     decodes (image.decode() raced against a hard timeout, so a slow network
 *     can never stall the show). Minimum hold keeps the beat readable even
 *     when the art is instant/absent.
 *  2. GO — the sweep/slam (CSS keyframes sized by the --super-go custom
 *     property so JS timers and CSS agree), with the faction impact flash in
 *     the final third and cleanup just after the fade.
 * Desktop totals ≈ 1.08–1.15s; small screens ≈ 0.88–0.95s; the reduced-motion
 * "lite" variant stays a quick calm pop (~460ms) — never the long form.
 */
const SUPER_REVEAL_MIN_MS = 180;
const SUPER_DECODE_TIMEOUT_MS = 250;
const SUPER_GO_MS = 900;
const SUPER_GO_MOBILE_MS = 700;
/** Impact lands at this fraction of the GO phase (the final third). */
const SUPER_IMPACT_FRACTION = 0.66;
const SUPER_CLEANUP_SLACK_MS = 80;
const SUPER_LITE_LIFETIME_MS = 460;

/** Small-screen check for the shorter mobile pacing; safe anywhere. */
function smallScreen(): boolean {
  try {
    return window.innerWidth <= 640;
  } catch {
    return false;
  }
}

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
  // Explicit stability flags kill the layer outright. prefers-reduced-motion
  // is deliberately NOT checked here: it's a runtime check per moment, so it
  // can suppress the decorative spawns while still allowing the calm "lite"
  // attack-card presentation (and it reacts if the OS setting changes
  // mid-match).
  if (flag(FLAG_NO_ANIM) || flag(FLAG_LOW_POWER) || safeMode()) return () => {};

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

  // ---- Attack-card super-move cinematic ---------------------------------
  // MvC-style activation in two beats: the veil dims and the chosen card
  // pops in on the actor's side and HOLDS (a readable reveal while its art
  // decodes), then it streaks to a center slam behind faction speed lines and
  // a bold name ribbon, with the impact cue on the defender in the final
  // third — transform/opacity only. Under prefers-reduced-motion this stays
  // the quick "lite" read: a calm centered card pop + name + energy flash, no
  // sweep, no shake, no long form. Repeated supers replace the live one
  // instantly so spamming attacks stays snappy.
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });

  const onAttackCard = (event: Event): void => {
    const detail = (event as CustomEvent<AttackCardFxDetail>).detail;
    if (detail === undefined || detail === null || detached) return;
    const faction = factionFor(detail.actor);
    const lite = reducedMotion();
    board.querySelectorAll(".match-fx-super").forEach((el) => el.remove());

    const overlay = document.createElement("div");
    overlay.className =
      `match-fx-super match-fx-super--${detail.actor}` +
      (lite ? " match-fx-super--lite" : "") +
      (faction in ENERGY_TOKENS ? ` match-fx--${faction.toLowerCase()}` : "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.setProperty(
      "--fx-energy",
      ENERGY_TOKENS[faction] ?? ENERGY_TOKENS["Neutral"]!,
    );

    const veil = document.createElement("div");
    veil.className = "match-fx-super__veil";
    overlay.append(veil);

    if (!lite) {
      for (let i = 1; i <= 3; i += 1) {
        const line = document.createElement("div");
        line.className = `match-fx-super__line match-fx-super__line--${i}`;
        overlay.append(line);
      }
    }

    const card = document.createElement("div");
    card.className = "match-fx-super__card";
    let art: HTMLImageElement | null = null;
    if (detail.artUrl !== undefined) {
      art = document.createElement("img");
      art.className = "match-fx-super__art";
      art.src = detail.artUrl;
      art.alt = "";
      art.decoding = "async";
      card.append(art);
    } else {
      card.classList.add("match-fx-super__card--text");
      card.textContent = detail.cardName;
    }
    const name = document.createElement("p");
    name.className = "match-fx-super__name";
    name.textContent = detail.cardName;
    overlay.append(card, name);
    board.append(overlay);

    if (lite) {
      const cleanup = setTimeout(() => {
        overlay.remove();
        timers.delete(cleanup);
      }, SUPER_LITE_LIFETIME_MS);
      timers.add(cleanup);
      return;
    }

    // Full cinematic: hold the reveal until the art is ready — image.decode()
    // raced against a hard timeout so a slow/failed load can never stall the
    // show — but never shorter than the minimum dramatic beat. Then flip to
    // the GO phase (CSS reads the duration from --super-go so the keyframes
    // and these timers stay in lockstep).
    const goMs = smallScreen() ? SUPER_GO_MOBILE_MS : SUPER_GO_MS;
    overlay.style.setProperty("--super-go", `${goMs}ms`);
    const artReady: Promise<unknown> =
      art !== null && typeof art.decode === "function"
        ? Promise.race([art.decode().catch(() => {}), wait(SUPER_DECODE_TIMEOUT_MS)])
        : Promise.resolve();
    void (async () => {
      await Promise.all([wait(SUPER_REVEAL_MIN_MS), artReady]);
      // Detached, or already replaced by a newer super: this one is done.
      if (detached || !overlay.isConnected) return;
      overlay.classList.add("match-fx-super--go");
      const impactTimer = setTimeout(() => {
        timers.delete(impactTimer);
        if (detached) return;
        spawn("match-fx--impact", tileOf(detail.targetInstanceId), faction);
        microShake();
      }, Math.round(goMs * SUPER_IMPACT_FRACTION));
      timers.add(impactTimer);
      const cleanup = setTimeout(() => {
        overlay.remove();
        timers.delete(cleanup);
      }, goMs + SUPER_CLEANUP_SLACK_MS);
      timers.add(cleanup);
    })();
  };
  board.addEventListener(ATTACK_CARD_FX_EVENT, onAttackCard);

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
    board.removeEventListener(ATTACK_CARD_FX_EVENT, onAttackCard);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    board.querySelectorAll(".match-fx, .match-fx-super").forEach((el) => el.remove());
  };
}
