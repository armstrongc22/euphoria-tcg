/**
 * @vitest-environment jsdom
 *
 * Stability flags: derived switches, Safe Mode composition, and the tighter caps
 * low-power applies. Pure localStorage reads.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FLAG_LOW_POWER,
  FLAG_NO_ANIM,
  FLAG_NO_SNAPSHOT,
  FLAG_SAFE_MODE,
  lowPowerActive,
  noAnim,
  noSnapshot,
  renderedLogCap,
  safeMode,
  snapshotThrottleMs,
} from "../src/debug-flags";

afterEach(() => window.localStorage.clear());

describe("debug-flags", () => {
  it("defaults every switch off (desktop unaffected)", () => {
    expect(safeMode()).toBe(false);
    expect(lowPowerActive()).toBe(false);
    expect(noAnim()).toBe(false);
    expect(noSnapshot()).toBe(false);
    expect(renderedLogCap()).toBe(60);
    expect(snapshotThrottleMs()).toBe(1000);
  });

  it("low-power tightens the rendered-log cap to 25", () => {
    window.localStorage.setItem(FLAG_LOW_POWER, "1");
    expect(lowPowerActive()).toBe(true);
    expect(renderedLogCap()).toBe(25);
  });

  it("Safe Mode composes low-power + no-anim + condensed playback + throttle", () => {
    window.localStorage.setItem(FLAG_SAFE_MODE, "1");
    expect(safeMode()).toBe(true);
    expect(lowPowerActive()).toBe(true);
    expect(noAnim()).toBe(true);
    expect(renderedLogCap()).toBe(25);
    expect(snapshotThrottleMs()).toBe(4000);
  });

  it("individual no-anim and no-snapshot flags work in isolation", () => {
    window.localStorage.setItem(FLAG_NO_ANIM, "1");
    expect(noAnim()).toBe(true);
    expect(noSnapshot()).toBe(false);
    window.localStorage.setItem(FLAG_NO_SNAPSHOT, "1");
    expect(noSnapshot()).toBe(true);
  });
});
