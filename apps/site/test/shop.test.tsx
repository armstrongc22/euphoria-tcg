/**
 * /shop — Fourthwall data layer + page smoke tests.
 *
 * The data layer is pure (normalizeProduct/toBlurb/applyPinnedOrder), so its
 * tolerance for API drift is tested directly. The page is rendered with
 * react-dom/server (no effects run → the "loading" pre-fetch state), which
 * pins the static contract: hero copy, tabs, always-reachable collection rack
 * with correct Fourthwall URLs, and the bottom CTA.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Shop } from "../src/pages/Shop";
import {
  COLLECTIONS,
  SHOP_DOMAIN,
  applyPinnedOrder,
  formatPrice,
  normalizeProduct,
  productUrl,
  toBlurb,
  type ShopProduct,
} from "../src/shop/fourthwall";

const rawProduct = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "prod-1",
  name: "Dwarf Faction Tee",
  slug: "dwarf-faction-tee",
  description: "<p>Heavy cotton &amp; <b>graffiti</b> print.</p>",
  state: { type: "AVAILABLE" },
  access: { type: "PUBLIC" },
  images: [{ id: "img-1", url: "https://cdn.example/tee.png", width: 900, height: 900 }],
  variants: [
    { id: "v1", name: "S", unitPrice: { value: 32, currency: "USD" } },
    {
      id: "v2",
      name: "M",
      unitPrice: { value: 28, currency: "USD" },
      compareAtPrice: { value: 35, currency: "USD" },
    },
  ],
  ...over,
});

describe("fourthwall data layer", () => {
  it("normalizes a product: image, lowest variant price, plain-text blurb", () => {
    const p = normalizeProduct(rawProduct(), "shirts")!;
    expect(p.id).toBe("prod-1");
    expect(p.name).toBe("Dwarf Faction Tee");
    expect(p.image?.url).toBe("https://cdn.example/tee.png");
    expect(p.price).toEqual({ value: 28, currency: "USD" });
    expect(p.compareAtPrice).toEqual({ value: 35, currency: "USD" });
    expect(p.blurb).toBe("Heavy cotton & graffiti print.");
    expect(p.available).toBe(true);
    expect(p.collection).toBe("shirts");
    expect(p.url).toBe(`${SHOP_DOMAIN}/products/dwarf-faction-tee`);
  });

  it("skips non-PUBLIC products and unusable rows without throwing", () => {
    expect(normalizeProduct(rawProduct({ access: { type: "HIDDEN" } }), "shirts")).toBeNull();
    expect(normalizeProduct(rawProduct({ id: undefined }), "shirts")).toBeNull();
    expect(normalizeProduct(null, "shirts")).toBeNull();
    expect(normalizeProduct("garbage", "shirts")).toBeNull();
  });

  it("tolerates missing images/variants/description (card still renders)", () => {
    const p = normalizeProduct(
      rawProduct({ images: undefined, variants: [], description: undefined }),
      "hoodies",
    )!;
    expect(p.image).toBeNull();
    expect(p.price).toBeNull();
    expect(p.blurb).toBe("");
  });

  it("marks SOLD_OUT products unavailable", () => {
    const p = normalizeProduct(rawProduct({ state: { type: "SOLD_OUT" } }), "shirts")!;
    expect(p.available).toBe(false);
  });

  it("formats prices and builds hosted product URLs", () => {
    expect(formatPrice({ value: 29.99, currency: "USD" })).toBe("$29.99");
    expect(productUrl("map-poster")).toBe(`${SHOP_DOMAIN}/products/map-poster`);
  });

  it("toBlurb strips tags and caps length on a word boundary", () => {
    expect(toBlurb("<div>Short &amp; sweet</div>")).toBe("Short & sweet");
    const long = `<p>${"word ".repeat(60)}</p>`;
    const blurb = toBlurb(long);
    expect(blurb.length).toBeLessThanOrEqual(141);
    expect(blurb.endsWith("…")).toBe(true);
  });

  it("applyPinnedOrder floats curated slugs to the front, stable otherwise", () => {
    const mk = (slug: string): ShopProduct =>
      ({ ...normalizeProduct(rawProduct({ slug, id: slug }), "shirts")! });
    const ordered = applyPinnedOrder([mk("a"), mk("b"), mk("c")], ["c", "a"]);
    expect(ordered.map((p) => p.slug)).toEqual(["c", "a", "b"]);
    // No pins → untouched copy.
    expect(applyPinnedOrder([mk("a"), mk("b")], []).map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("collection config points at the real Fourthwall collection pages", () => {
    const byHandle = Object.fromEntries(COLLECTIONS.map((c) => [c.handle, c.url]));
    expect(byHandle["shirts"]).toBe(`${SHOP_DOMAIN}/collections/shirts`);
    expect(byHandle["hoodies"]).toBe(`${SHOP_DOMAIN}/collections/hoodies`);
    expect(byHandle["posters-and-stickers"]).toBe(
      `${SHOP_DOMAIN}/collections/posters-and-stickers`,
    );
    // Unconfigured local/test builds still target the live shop.
    expect(SHOP_DOMAIN).toBe("https://euphoriauniverse-shop.fourthwall.com");
  });
});

describe("Shop page (static contract)", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Shop />
    </MemoryRouter>,
  );

  it("renders the hero with the launch copy", () => {
    expect(html).toContain("Euphoria Merch");
    expect(html).toContain("Rep the factions. Support the manga. Enter the world.");
  });

  it("renders the three collection tabs", () => {
    expect(html).toContain("Shirts");
    expect(html).toContain("Hoodies");
    expect(html).toContain("Posters &amp; Stickers");
  });

  it("always renders the collection rack with hosted Fourthwall links", () => {
    for (const c of COLLECTIONS) {
      expect(html).toContain(`href="${c.url}"`);
    }
  });

  it("renders the bottom CTA row (beta + dispatch + full shop)", () => {
    expect(html).toContain("Play the beta. Join the list. Support the launch.");
    expect(html).toContain("Play the Beta");
    expect(html).toContain("Join the Dispatch");
    expect(html).toContain(`href="${SHOP_DOMAIN}"`);
  });

  it("shows the loading skeleton before any fetch resolves", () => {
    expect(html).toContain("eu-shop-card--skeleton");
  });
});
