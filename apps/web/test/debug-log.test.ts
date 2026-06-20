/**
 * @vitest-environment jsdom
 *
 * Opt-in mobile diagnostics: the ring buffer, the debug-flag gate, and the
 * "ended unexpectedly during a match" heuristic used to chase the forced reload.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEBUG_FLAG_KEY,
  MAX_DEBUG_EVENTS,
  clearDebugLog,
  debugEnabled,
  endedUnexpectedlyDuringMatch,
  logDebug,
  readDebugLog,
  setMatchActive,
} from "../src/debug-log";

afterEach(() => {
  window.localStorage.clear();
});

describe("debug-log", () => {
  it("records nothing unless the debug flag is set", () => {
    expect(debugEnabled()).toBe(false);
    logDebug("metrics", { turn: 3 });
    expect(readDebugLog()).toEqual([]);
  });

  it("records events into a capped ring buffer when enabled", () => {
    window.localStorage.setItem(DEBUG_FLAG_KEY, "1");
    for (let i = 0; i < MAX_DEBUG_EVENTS + 20; i++) logDebug("metrics", { i });
    const log = readDebugLog();
    expect(log.length).toBe(MAX_DEBUG_EVENTS);
    // Oldest dropped: the last event is the most recent.
    expect(log[log.length - 1]!.data?.["i"]).toBe(MAX_DEBUG_EVENTS + 19);
    clearDebugLog();
    expect(readDebugLog()).toEqual([]);
  });

  it("flags a pagehide that happened while a match was active", () => {
    window.localStorage.setItem(DEBUG_FLAG_KEY, "1");
    setMatchActive(true);
    logDebug("pagehide", { matchActive: true });
    expect(endedUnexpectedlyDuringMatch()).toBe(true);
  });

  it("does not flag a clean match end", () => {
    window.localStorage.setItem(DEBUG_FLAG_KEY, "1");
    setMatchActive(true);
    setMatchActive(false); // clean matchEnd marker
    expect(endedUnexpectedlyDuringMatch()).toBe(false);
  });

  it("flags an uncaught error as an unexpected end", () => {
    window.localStorage.setItem(DEBUG_FLAG_KEY, "1");
    setMatchActive(true);
    logDebug("error", { message: "boom" });
    expect(endedUnexpectedlyDuringMatch()).toBe(true);
  });
});
