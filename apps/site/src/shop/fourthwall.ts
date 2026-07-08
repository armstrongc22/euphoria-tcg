/**
 * Fourthwall Storefront data layer for the /shop page.
 *
 * Talks ONLY to the public Storefront API (read-only product catalog) with the
 * public storefront token — never admin/Platform credentials. Checkout stays on
 * Fourthwall: every CTA deep-links to the hosted shop.
 *
 * Environment (Vite, inlined at build time; see .env.local.example and the
 * deploy workflow):
 *   VITE_FOURTHWALL_STOREFRONT_TOKEN  public storefront token (ptkn_…)
 *   VITE_FOURTHWALL_SHOP_DOMAIN       hosted shop origin (defaults to the
 *                                     live euphoriauniverse-shop domain)
 *
 * When the token is absent or the API is unreachable, callers fall back to
 * collection cards that link straight to the hosted collection pages — the
 * shop degrades, it never breaks.
 */

const API_BASE = "https://storefront-api.fourthwall.com/v1";

/** The hosted shop origin (product/collection pages + checkout). Tolerates a
 *  configured value with or without protocol/trailing slash. */
function normalizeShopDomain(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (value === "") return "https://euphoriauniverse-shop.fourthwall.com";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export const SHOP_DOMAIN: string = normalizeShopDomain(
  import.meta.env["VITE_FOURTHWALL_SHOP_DOMAIN"] as string | undefined,
);

const STOREFRONT_TOKEN: string =
  (import.meta.env["VITE_FOURTHWALL_STOREFRONT_TOKEN"] as string | undefined) ?? "";

/** True when the Storefront API can be queried at all. */
export function isShopConfigured(): boolean {
  return STOREFRONT_TOKEN.length > 0;
}

// ---- Collections -----------------------------------------------------------

export type CollectionHandle = "shirts" | "hoodies" | "posters-and-stickers";

export interface ShopCollection {
  readonly handle: CollectionHandle;
  readonly title: string;
  readonly blurb: string;
  /** fx-token energy var suffix for the accent (see fx-tokens.css). */
  readonly tone: "monk" | "surfer" | "sonic" | "dwarf" | "shaman";
  /** Hosted collection page — the fallback destination when the API is down. */
  readonly url: string;
}

/** Display order of the shop's collections (tabs + fallback cards). */
export const COLLECTIONS: readonly ShopCollection[] = [
  {
    handle: "shirts",
    title: "Shirts",
    blurb: "Faction tees and graffiti prints.",
    tone: "monk",
    url: `${SHOP_DOMAIN}/collections/shirts`,
  },
  {
    handle: "hoodies",
    title: "Hoodies",
    blurb: "Heavyweight hoodies for the cold fronts.",
    tone: "surfer",
    url: `${SHOP_DOMAIN}/collections/hoodies`,
  },
  {
    handle: "posters-and-stickers",
    title: "Posters & Stickers",
    blurb: "Card art, world maps, and sticker sheets.",
    tone: "sonic",
    url: `${SHOP_DOMAIN}/collections/posters-and-stickers`,
  },
] as const;

/** Fourthwall's built-in catch-all collection (fallback data source). */
export const ALL_COLLECTION_HANDLE = "all";

// ---- Curation (the future-features surface) --------------------------------

/**
 * One editable object drives merchandising, so featured picks, ordering,
 * bundles, and discount callouts land WITHOUT touching the page component:
 *
 *  - `featuredSlugs`: hand-picked featured products (else the page auto-picks
 *    from shirts/hoodies);
 *  - `pinnedSlugs`: products floated to the front of their collection grid;
 *  - `promo`: an optional discount/coupon/bundle banner on the shop page.
 */
export interface ShopPromo {
  readonly headline: string;
  readonly body: string;
  /** Optional coupon code rendered as copyable text. */
  readonly code?: string;
  /** Optional destination (a bundle/collection page); defaults to the shop. */
  readonly url?: string;
}

export interface ShopCuration {
  readonly featuredSlugs: readonly string[];
  readonly pinnedSlugs: readonly string[];
  readonly promo: ShopPromo | null;
}

export const CURATION: ShopCuration = {
  featuredSlugs: [],
  pinnedSlugs: [],
  promo: null,
};

// ---- Products ---------------------------------------------------------------

export interface ShopMoney {
  readonly value: number;
  readonly currency: string;
}

export interface ShopProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Plain-text short blurb (source description is HTML; tags stripped). */
  readonly blurb: string;
  readonly image: { readonly url: string; readonly width?: number; readonly height?: number } | null;
  /** Lowest variant price ("from" price when variants differ), or null. */
  readonly price: ShopMoney | null;
  /** Strike-through price when the product is discounted, or null. */
  readonly compareAtPrice: ShopMoney | null;
  readonly available: boolean;
  /** Hosted product page (detail + checkout live on Fourthwall). */
  readonly url: string;
  /** The collection handle this product was fetched from. */
  readonly collection: string;
}

/** Hosted product-page URL for a product slug. */
export function productUrl(slug: string): string {
  return `${SHOP_DOMAIN}/products/${slug}`;
}

/** "$29.99" / "€24.00" — falls back to "USD 29.99" for unknown currencies. */
export function formatPrice(money: ShopMoney): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: money.currency,
    }).format(money.value);
  } catch {
    return `${money.currency} ${money.value.toFixed(2)}`;
  }
}

/** Strips HTML tags/entities down to readable plain text, hard-capped. */
export function toBlurb(html: string, maxLength = 140): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf(" ")))}…`;
}

/**
 * Narrows one raw Storefront-API product to a {@link ShopProduct}. Returns
 * null for rows we can't render (missing id/slug/name) or shouldn't (access
 * anything but PUBLIC). Never throws on odd shapes — the shop must survive
 * API drift with a skipped card, not a blank page.
 */
export function normalizeProduct(raw: unknown, collection: string): ShopProduct | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const id = typeof p["id"] === "string" ? p["id"] : null;
  const slug = typeof p["slug"] === "string" ? p["slug"] : null;
  const name = typeof p["name"] === "string" ? p["name"] : null;
  if (id === null || slug === null || name === null) return null;

  const access = (p["access"] as { type?: string } | undefined)?.type;
  if (access !== undefined && access !== "PUBLIC") return null;

  const imagesRaw = Array.isArray(p["images"]) ? (p["images"] as unknown[]) : [];
  let image: ShopProduct["image"] = null;
  for (const entry of imagesRaw) {
    const i = entry as { url?: unknown; width?: unknown; height?: unknown };
    if (typeof i?.url === "string") {
      image = {
        url: i.url,
        ...(typeof i.width === "number" ? { width: i.width } : {}),
        ...(typeof i.height === "number" ? { height: i.height } : {}),
      };
      break;
    }
  }

  // Lowest variant price = the honest "from" price for the card.
  const variantsRaw = Array.isArray(p["variants"]) ? (p["variants"] as unknown[]) : [];
  let price: ShopMoney | null = null;
  let compareAtPrice: ShopMoney | null = null;
  for (const entry of variantsRaw) {
    const v = entry as {
      unitPrice?: { value?: unknown; currency?: unknown };
      compareAtPrice?: { value?: unknown; currency?: unknown };
    };
    const value = v?.unitPrice?.value;
    const currency = v?.unitPrice?.currency;
    if (typeof value !== "number" || typeof currency !== "string") continue;
    if (price === null || value < price.value) {
      price = { value, currency };
      const cav = v.compareAtPrice?.value;
      const cac = v.compareAtPrice?.currency;
      compareAtPrice =
        typeof cav === "number" && typeof cac === "string" && cav > value
          ? { value: cav, currency: cac }
          : null;
    }
  }

  const state = (p["state"] as { type?: string } | undefined)?.type;
  const description = typeof p["description"] === "string" ? p["description"] : "";

  return {
    id,
    slug,
    name,
    blurb: toBlurb(description),
    image,
    price,
    compareAtPrice,
    available: state !== "SOLD_OUT",
    url: productUrl(slug),
    collection,
  };
}

/**
 * Fetches a collection's products from the Storefront API. Throws when the
 * shop is unconfigured or the request fails — callers render the fallback
 * collection card for that section.
 */
export async function fetchCollectionProducts(
  handle: string,
  init?: { readonly signal?: AbortSignal },
): Promise<ShopProduct[]> {
  if (!isShopConfigured()) throw new Error("Storefront token not configured.");
  const params = new URLSearchParams({
    storefront_token: STOREFRONT_TOKEN,
    currency: "USD",
    size: "50",
  });
  const res = await fetch(`${API_BASE}/collections/${handle}/products?${params}`, {
    signal: init?.signal ?? null,
  });
  if (!res.ok) throw new Error(`Storefront API ${res.status} for "${handle}".`);
  const body = (await res.json()) as { results?: unknown[] };
  const results = Array.isArray(body.results) ? body.results : [];
  const products: ShopProduct[] = [];
  for (const raw of results) {
    const product = normalizeProduct(raw, handle);
    if (product !== null) products.push(product);
  }
  return products;
}

/** Floats curated pinned slugs to the front, preserving API order otherwise. */
export function applyPinnedOrder(
  products: readonly ShopProduct[],
  pinnedSlugs: readonly string[] = CURATION.pinnedSlugs,
): ShopProduct[] {
  if (pinnedSlugs.length === 0) return [...products];
  const rank = new Map(pinnedSlugs.map((slug, i) => [slug, i]));
  return [...products].sort(
    (a, b) => (rank.get(a.slug) ?? Infinity) - (rank.get(b.slug) ?? Infinity),
  );
}
