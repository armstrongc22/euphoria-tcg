/**
 * Debug/stability localStorage toggles for isolating the mobile forced-reload.
 * Pure reads of localStorage — safe to import anywhere, cheap, and a no-op when
 * storage is unavailable. None of these change behavior unless explicitly set;
 * desktop is unaffected unless a flag is enabled (Feature B/C).
 *
 * Flags (all "1" to enable):
 *   euphoriaDebug      — master gate: diagnostics + in-app debug panel.
 *   euphoriaLowPower   — shed live-match visual weight (tighter caps).
 *   euphoriaNoAnim     — disable Web Animations / beams / floating-text motion.
 *   euphoriaNoArt      — replace live card art with lightweight placeholders.
 *   euphoriaNoPlayback — condense opponent playback to a minimal callout.
 *   euphoriaNoSnapshot — disable resume-snapshot writes (isolate write pressure).
 *   euphoriaSafeMode   — Mobile Safe Mode: combines the mitigations below.
 */

export const FLAG_DEBUG = "euphoriaDebug";
export const FLAG_LOW_POWER = "euphoriaLowPower";
export const FLAG_NO_ANIM = "euphoriaNoAnim";
export const FLAG_NO_ART = "euphoriaNoArt";
export const FLAG_NO_PLAYBACK = "euphoriaNoPlayback";
export const FLAG_NO_SNAPSHOT = "euphoriaNoSnapshot";
export const FLAG_SAFE_MODE = "euphoriaSafeMode";

/** Every toggle the debug panel exposes (the master gate is handled separately). */
export const STABILITY_FLAGS = [
  FLAG_SAFE_MODE,
  FLAG_LOW_POWER,
  FLAG_NO_ANIM,
  FLAG_NO_ART,
  FLAG_NO_PLAYBACK,
  FLAG_NO_SNAPSHOT,
] as const;

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Raw flag read: true when localStorage[name] === "1". */
export function flag(name: string): boolean {
  return ls()?.getItem(name) === "1";
}

/** Sets or clears a flag (used by the panel's toggles). */
export function setFlag(name: string, on: boolean): void {
  const store = ls();
  if (store === null) return;
  try {
    if (on) store.setItem(name, "1");
    else store.removeItem(name);
  } catch {
    /* best-effort */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** Coarse "this is a phone" heuristic (coarse pointer + small viewport). */
export function isLikelyMobile(): boolean {
  try {
    const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
    const small = globalThis.matchMedia?.("(max-width: 820px)").matches ?? false;
    return coarse && small;
  } catch {
    return false;
  }
}

// --- Derived, behavior-driving switches (what the board actually reads) ------

/** Mobile Safe Mode master toggle. */
export function safeMode(): boolean {
  return flag(FLAG_SAFE_MODE);
}

/**
 * Shed visual weight: explicit low-power, safe mode, reduced-motion, or a likely
 * phone with the low-power flag. Never auto-on for desktop without a flag.
 */
export function lowPowerActive(): boolean {
  return flag(FLAG_LOW_POWER) || safeMode() || prefersReducedMotion();
}

/** Disable Web Animations / beams / floating-text motion. */
export function noAnim(): boolean {
  return flag(FLAG_NO_ANIM) || safeMode() || prefersReducedMotion();
}

/** Replace live-match card art with lightweight placeholders. */
export function noArt(): boolean {
  return flag(FLAG_NO_ART);
}

/** Condense opponent playback to a minimal callout (skip step-by-step). */
export function noPlayback(): boolean {
  return flag(FLAG_NO_PLAYBACK) || safeMode();
}

/** Disable resume-snapshot writes entirely (explicit only). */
export function noSnapshot(): boolean {
  return flag(FLAG_NO_SNAPSHOT);
}

/** Minimum ms between resume-snapshot writes (throttle harder in safe mode). */
export function snapshotThrottleMs(): number {
  return safeMode() || lowPowerActive() ? 4000 : 1000;
}

/** Rendered battle-log row cap: 25 on low-power/safe mode, else 60. */
export function renderedLogCap(): number {
  return lowPowerActive() ? 25 : 60;
}

/** Max card-art nodes kept in the per-board cache. */
export function artCacheCap(): number {
  return lowPowerActive() ? 24 : 48;
}
