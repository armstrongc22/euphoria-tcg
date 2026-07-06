import { describe, expect, it, vi } from "vitest";
import { importWithStaleChunkRecovery } from "../src/map/Flight3D";

/** Minimal in-memory stand-in for sessionStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe("importWithStaleChunkRecovery", () => {
  it("passes through a successful import and clears the reload flag", async () => {
    const storage = fakeStorage({ "eu-flight-chunk-reloaded": "1" });
    const reload = vi.fn();
    const mod = await importWithStaleChunkRecovery(
      async () => ({ default: "scene" }),
      reload,
      storage,
    );
    expect(mod).toEqual({ default: "scene" });
    expect(reload).not.toHaveBeenCalled();
    expect(storage.dump()).toEqual({});
  });

  it("reloads once on a failed chunk import (stale deploy) without settling", async () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    let settled = false;
    void importWithStaleChunkRecovery(
      () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
      reload,
      storage,
    ).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.dump()).toEqual({ "eu-flight-chunk-reloaded": "1" });
    // Never settles — the page is navigating away; Suspense keeps its fallback.
    expect(settled).toBe(false);
  });

  it("rethrows when the import still fails after a recovery reload", async () => {
    const storage = fakeStorage({ "eu-flight-chunk-reloaded": "1" });
    const reload = vi.fn();
    await expect(
      importWithStaleChunkRecovery(
        () => Promise.reject(new TypeError("still broken")),
        reload,
        storage,
      ),
    ).rejects.toThrow("still broken");
    expect(reload).not.toHaveBeenCalled();
  });

  it("rethrows immediately when storage is unavailable (no reload loop risk)", async () => {
    const reload = vi.fn();
    await expect(
      importWithStaleChunkRecovery(() => Promise.reject(new Error("boom")), reload, null),
    ).rejects.toThrow("boom");
    expect(reload).not.toHaveBeenCalled();
  });
});
