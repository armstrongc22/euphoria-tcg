import { describe, expect, it } from "vitest";
import {
  isUnlockReached,
  registerTap,
  UNLOCK_TAPS,
  UNLOCK_WINDOW_MS,
} from "../src/map/notation";

describe("registerTap", () => {
  it("starts the counter on the first tap", () => {
    const s = registerTap(null, 1000);
    expect(s).toEqual({ count: 1, firstAt: 1000 });
  });

  it("increments within the window, keeping the original start time", () => {
    let s = registerTap(null, 0);
    s = registerTap(s, 500);
    s = registerTap(s, 1000);
    expect(s).toEqual({ count: 3, firstAt: 0 });
  });

  it("restarts once the window elapses", () => {
    const s = registerTap({ count: 4, firstAt: 0 }, UNLOCK_WINDOW_MS + 1);
    expect(s).toEqual({ count: 1, firstAt: UNLOCK_WINDOW_MS + 1 });
  });
});

describe("isUnlockReached", () => {
  it("unlocks after exactly five quick taps", () => {
    let s = registerTap(null, 0);
    for (let i = 1; i < UNLOCK_TAPS; i++) {
      s = registerTap(s, i * 100); // all well inside the window
      if (i < UNLOCK_TAPS - 1) expect(isUnlockReached(s)).toBe(false);
    }
    expect(s.count).toBe(UNLOCK_TAPS);
    expect(isUnlockReached(s)).toBe(true);
  });

  it("does not unlock when taps are too slow", () => {
    let s: ReturnType<typeof registerTap> | null = null;
    for (let i = 0; i < UNLOCK_TAPS; i++) {
      s = registerTap(s, i * (UNLOCK_WINDOW_MS + 10)); // each gap exceeds window
    }
    expect(s).not.toBeNull();
    expect(isUnlockReached(s!)).toBe(false);
    expect(s!.count).toBe(1);
  });
});
