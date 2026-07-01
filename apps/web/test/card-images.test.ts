/**
 * @vitest-environment jsdom
 *
 * Card-image performance behaviors (Phase 3A): the collection grid renders the
 * optimized thumbnail with lazy/async attributes and falls back to the full-size
 * PNG when a thumbnail is missing; the preloader dedupes repeated requests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cards, cardImageUrl, cardThumbUrl } from "@euphoria/core/cards";
import { renderGrid } from "../src/grid";

const sample = cards.slice(0, 3);

describe("collection grid images", () => {
  it("loads the optimized thumbnail, lazily and async-decoded", () => {
    const container = document.createElement("div");
    renderGrid(container, sample);
    const imgs = container.querySelectorAll<HTMLImageElement>("img.card__art");
    expect(imgs.length).toBe(sample.length);
    for (const img of imgs) {
      expect(img.loading).toBe("lazy");
      expect(img.decoding).toBe("async");
      // src is the optimized .webp thumbnail, not the full PNG.
      expect(img.getAttribute("src")).toMatch(/optimized\/.+\.webp$/);
    }
  });

  it("falls back to the full-size PNG when the thumbnail 404s", () => {
    const container = document.createElement("div");
    renderGrid(container, [sample[0]!]);
    const img = container.querySelector<HTMLImageElement>("img.card__art")!;
    expect(img.src).toContain(cardThumbUrl(sample[0]!, ""));
    // Simulate a missing thumbnail.
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toContain(cardImageUrl(sample[0]!, "").replace(/^\//, ""));
    expect(img.classList.contains("card__art--missing")).toBe(false);
    // A second failure (full-size also missing) degrades to the placeholder.
    img.dispatchEvent(new Event("error"));
    expect(img.classList.contains("card__art--missing")).toBe(true);
  });
});

describe("preloadCardArt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("warms each thumbnail once and dedupes repeats", async () => {
    const urls: string[] = [];
    class FakeImage {
      decoding = "";
      set src(value: string) {
        urls.push(value);
      }
    }
    vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
    // Fresh module so the internal dedupe set is empty (isolated from other tests).
    vi.resetModules();
    const mod = await import("@euphoria/core/cards");
    const list = mod.cards.slice(0, 3);

    mod.preloadCardArt(list, "/beta/");
    expect(urls.length).toBe(list.length);
    for (const card of list) {
      expect(urls).toContain(mod.cardThumbUrl(card, "/beta/"));
    }
    // Requesting the same art again issues no new requests.
    mod.preloadCardArt(list, "/beta/");
    expect(urls.length).toBe(list.length);
  });
});
