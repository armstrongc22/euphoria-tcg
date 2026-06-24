/**
 * @vitest-environment jsdom
 *
 * In-app debug panel: gated by euphoriaDebug, shows build stamp + metrics +
 * snapshot info + toggles, and the Copy Debug Dump button degrades safely.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebugPanel, buildDebugDump } from "../src/debug-panel";
import { setBuildStamp, setMetricsProvider } from "@euphoria/core/debug-log";
import { FLAG_DEBUG, FLAG_NO_ANIM } from "../src/debug-flags";
import { saveActiveMatch } from "../src/match-recovery";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const hooks = (store: KeyValueStore | null) => ({
  userId: () => "user-1",
  currentView: () => "live-match",
  store,
  reward: () => ({
    mode: "supabase",
    wins: 7,
    nextReward: 10,
    owned: 0,
    pending: 1,
    pendingErrors: ["Fafnir: could not be read back"],
  }),
  forceSave: () => true,
  simulateReloadCheck: () => "Reload check: OK",
});

afterEach(() => {
  window.localStorage.clear();
  setMetricsProvider(null);
});

describe("createDebugPanel", () => {
  it("returns null when euphoriaDebug is not enabled", () => {
    expect(createDebugPanel(hooks(memoryStore()))).toBeNull();
  });

  it("renders build stamp + live metrics when enabled", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    setBuildStamp("abc1234");
    setMetricsProvider(() => ({ turn: 7, events: 120, domNodes: 300 }));
    const panel = createDebugPanel(hooks(memoryStore()));
    expect(panel).not.toBeNull();
    const text = panel!.element.textContent ?? "";
    expect(text).toContain("abc1234");
    expect(text).toContain("turn");
    expect(text).toContain("7");
    expect(text).toContain("120");
  });

  it("renders the reward pipeline snapshot (mode, wins, owned, pending + error)", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    const panel = createDebugPanel(hooks(memoryStore()));
    const text = panel!.element.textContent ?? "";
    expect(text).toContain("supabase");
    expect(text).toContain("nextReward");
    expect(text).toContain("could not be read back");
  });

  it("toggles a stability flag via its button", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    const panel = createDebugPanel(hooks(memoryStore()))!;
    const toggle = panel.element.querySelector<HTMLButtonElement>(
      `.debug-panel__toggle[data-flag="${FLAG_NO_ANIM}"]`,
    )!;
    expect(window.localStorage.getItem(FLAG_NO_ANIM)).toBeNull();
    toggle.click();
    expect(window.localStorage.getItem(FLAG_NO_ANIM)).toBe("1");
    toggle.click();
    expect(window.localStorage.getItem(FLAG_NO_ANIM)).toBeNull();
  });

  it("shows resumable snapshot existence, age, and turn", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    const store = memoryStore();
    saveActiveMatch(store, {
      userId: "user-1",
      faction: "Sonic",
      opponentFaction: "Dwarf",
      seed: 5,
      playerDeck: null,
      actions: [],
      turn: 9,
    });
    const panel = createDebugPanel(hooks(store))!;
    expect(panel.element.textContent).toContain("turn 9");
  });

  it("Copy Debug Dump degrades safely without a clipboard", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    const panel = createDebugPanel(hooks(memoryStore()))!;
    const copy = Array.from(
      panel.element.querySelectorAll<HTMLButtonElement>(".debug-panel__btn"),
    ).find((b) => b.textContent === "Copy Debug Dump")!;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // jsdom has no navigator.clipboard — must not throw; falls back to console.
    expect(() => copy.click()).not.toThrow();
    spy.mockRestore();
  });
});

describe("buildDebugDump", () => {
  it("includes build, flags, metrics, and recent events", () => {
    window.localStorage.setItem(FLAG_DEBUG, "1");
    setBuildStamp("deadbee");
    setMetricsProvider(() => ({ turn: 3 }));
    const dump = buildDebugDump(hooks(memoryStore()));
    expect(dump["build"]).toBe("deadbee");
    expect((dump["metrics"] as Record<string, number>)["turn"]).toBe(3);
    expect(dump["flags"]).toHaveProperty(FLAG_NO_ANIM);
    expect(Array.isArray(dump["recentEvents"])).toBe(true);
  });
});
