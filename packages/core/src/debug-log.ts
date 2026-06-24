/**
 * Lightweight, opt-in diagnostics for chasing the mobile forced-reload. Disabled
 * by default — everything is a cheap no-op unless `localStorage.euphoriaDebug`
 * is "1". When enabled it keeps a ring buffer of the last {@link MAX_DEBUG_EVENTS}
 * events in localStorage (so it survives the very reload we're investigating) and
 * captures the things a phone can't otherwise show: uncaught errors, promise
 * rejections, and page lifecycle (pagehide / visibilitychange / freeze).
 *
 * Enable on a device:  localStorage.euphoriaDebug = "1"   (then reload)
 * Dump on a device:    euphoriaDebugDump()                (in the console)
 *
 * No DOM/engine imports; safe to load anywhere.
 */

/** localStorage flag that turns diagnostics on. */
export const DEBUG_FLAG_KEY = "euphoriaDebug";
/** localStorage key holding the JSON ring buffer of recent events. */
export const DEBUG_LOG_KEY = "euphoria.debug.v1";
/** Most recent events retained (older ones are dropped). */
export const MAX_DEBUG_EVENTS = 50;

/** One recorded diagnostic event. */
export interface DebugEvent {
  /** ISO timestamp. */
  readonly t: string;
  /** Event kind, e.g. "error", "pagehide", "metrics". */
  readonly kind: string;
  /** Optional structured context. */
  readonly data?: Record<string, unknown>;
}

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True when the user opted into diagnostics on this device. */
export function debugEnabled(): boolean {
  return ls()?.getItem(DEBUG_FLAG_KEY) === "1";
}

/** Appends one event to the ring buffer (no-op unless debug is enabled). */
export function logDebug(kind: string, data?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  const store = ls();
  if (store === null) return;
  try {
    const raw = store.getItem(DEBUG_LOG_KEY);
    const arr: DebugEvent[] = raw ? (JSON.parse(raw) as DebugEvent[]) : [];
    arr.push({ t: new Date().toISOString(), kind, data });
    while (arr.length > MAX_DEBUG_EVENTS) arr.shift();
    store.setItem(DEBUG_LOG_KEY, JSON.stringify(arr));
  } catch {
    /* storage full/blocked — diagnostics are best-effort */
  }
}

/** Reads the recorded events (newest last), or [] if none/disabled/corrupt. */
export function readDebugLog(): DebugEvent[] {
  const store = ls();
  if (store === null) return [];
  try {
    const raw = store.getItem(DEBUG_LOG_KEY);
    return raw ? (JSON.parse(raw) as DebugEvent[]) : [];
  } catch {
    return [];
  }
}

/** Clears the recorded events. */
export function clearDebugLog(): void {
  ls()?.removeItem(DEBUG_LOG_KEY);
}

// Whether a live match is currently on screen — lets a pagehide be flagged as
// "unloaded mid-match", the signal we care about.
let matchActive = false;

/** Marks the live match as on/off screen (records a marker when debugging). */
export function setMatchActive(active: boolean): void {
  matchActive = active;
  logDebug(active ? "matchStart" : "matchEnd");
}

/** Records a periodic snapshot of match/runtime counters (debug only). */
export function recordMatchMetrics(metrics: Record<string, number>): void {
  lastMetrics = metrics;
  logDebug("metrics", metrics);
}

// --- live metrics for the in-app debug panel --------------------------------

/** The most recent metrics recorded by the active board (null when none). */
let lastMetrics: Record<string, number> | null = null;

/** A provider the active board registers so the panel can pull LIVE counters. */
type MetricsProvider = () => Record<string, number>;
let metricsProvider: MetricsProvider | null = null;

/** Registers (or clears with null) the live-metrics provider for the panel. */
export function setMetricsProvider(provider: MetricsProvider | null): void {
  metricsProvider = provider;
}

/** Current live match metrics (provider if registered, else the last snapshot). */
export function getLiveMetrics(): Record<string, number> {
  if (metricsProvider !== null) {
    try {
      return metricsProvider();
    } catch {
      /* provider threw — fall back to the last recorded snapshot */
    }
  }
  return lastMetrics ?? {};
}

/** The build stamp injected at build time (set once from main.ts). */
let buildStamp = "dev";
export function setBuildStamp(stamp: string): void {
  buildStamp = stamp;
}
export function getBuildStamp(): string {
  return buildStamp;
}

/** The last resume-snapshot save time, for the panel (set by the recovery flow). */
let lastSnapshotSaveAt: string | null = null;
export function noteSnapshotSaved(at: string = new Date().toISOString()): void {
  lastSnapshotSaveAt = at;
}
export function getLastSnapshotSaveAt(): string | null {
  return lastSnapshotSaveAt;
}

/** The most recent recorded error/rejection text, for the panel (or null). */
export function lastErrorText(): string | null {
  const events = readDebugLog();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "error" || e.kind === "unhandledrejection") {
      return String(e.data?.["message"] ?? e.data?.["reason"] ?? e.kind);
    }
  }
  return null;
}

/** The most recent page-lifecycle event kind/state, for the panel (or null). */
export function lastLifecycleEvent(): string | null {
  const events = readDebugLog();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "pagehide" || e.kind === "visibilitychange") {
      const state = e.data?.["state"];
      return state !== undefined ? `${e.kind}:${String(state)}` : e.kind;
    }
  }
  return null;
}

/**
 * Installs global lifecycle/error capture. No-op unless debug is enabled. Also
 * exposes `euphoriaDebugDump()` / `euphoriaDebugClear()` on the window for use
 * from a connected mobile console.
 */
export function installDiagnostics(target: Window = window): void {
  const w = target as Window & {
    euphoriaDebugDump?: () => DebugEvent[];
    euphoriaDebugClear?: () => void;
  };
  // These helpers are always available so a tester can inspect even before
  // toggling the flag on (the flag still gates what gets recorded).
  w.euphoriaDebugDump = () => readDebugLog();
  w.euphoriaDebugClear = () => clearDebugLog();
  if (!debugEnabled()) return;

  target.addEventListener("error", (e) => {
    const ev = e as ErrorEvent;
    logDebug("error", {
      message: String(ev.message),
      source: ev.filename,
      line: ev.lineno,
      matchActive,
    });
  });
  target.addEventListener("unhandledrejection", (e) => {
    const ev = e as PromiseRejectionEvent;
    logDebug("unhandledrejection", { reason: String(ev.reason), matchActive });
  });
  target.addEventListener("pagehide", () => logDebug("pagehide", { matchActive }));
  target.addEventListener("visibilitychange", () => {
    logDebug("visibilitychange", {
      state: target.document.visibilityState,
      matchActive,
    });
  });
  logDebug("diagnosticsInstalled", {
    ua: target.navigator?.userAgent ?? "unknown",
  });
}

/**
 * Heuristic: did the previous session look like it ended badly *during a match*?
 * True when the most recent meaningful event is an error, an unhandled rejection,
 * or a pagehide/visibility-hidden while a match was active and no clean matchEnd
 * followed. Used to surface a small recovery notice after a reload.
 */
export function endedUnexpectedlyDuringMatch(): boolean {
  if (!debugEnabled()) return false;
  const events = readDebugLog();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "matchEnd") return false;
    if (e.kind === "error" || e.kind === "unhandledrejection") return true;
    if (
      (e.kind === "pagehide" || e.kind === "visibilitychange") &&
      e.data?.["matchActive"] === true
    ) {
      return true;
    }
  }
  return false;
}
