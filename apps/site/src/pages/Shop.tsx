import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { BETA_URL } from "../beta";
import { trackShop } from "../shop/analytics";
import { usePageTitle } from "../usePageTitle";
import {
  ALL_COLLECTION_HANDLE,
  COLLECTIONS,
  CURATION,
  SHOP_DOMAIN,
  applyPinnedOrder,
  fetchCollectionProducts,
  formatPrice,
  type CollectionHandle,
  type ShopCollection,
  type ShopProduct,
} from "../shop/fourthwall";

/** Per-collection load state: products, a pending fetch, or a failed one. */
type Slot =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly products: readonly ShopProduct[] }
  | { readonly status: "error" };

type Slots = Readonly<Record<CollectionHandle, Slot>>;

const LOADING_SLOTS: Slots = {
  shirts: { status: "loading" },
  hoodies: { status: "loading" },
  "posters-and-stickers": { status: "loading" },
};

/** Energy accent for a collection card/tab (fx-tokens). */
const tone = (c: ShopCollection): CSSProperties =>
  ({ "--energy": `var(--eu-energy-${c.tone})` }) as CSSProperties;

/**
 * The Euphoria shop: Fourthwall's catalog rendered in the site's own visual
 * language. Product detail + checkout stay on Fourthwall (every CTA is an
 * outbound link); this page is the native storefront window. When the
 * Storefront API is unconfigured/unreachable it degrades to collection cards
 * that link to the hosted collection pages.
 */
export function Shop() {
  usePageTitle("Shop");
  const [slots, setSlots] = useState<Slots>(LOADING_SLOTS);
  const [allFallback, setAllFallback] = useState<readonly ShopProduct[] | null>(null);
  const [active, setActive] = useState<CollectionHandle>("shirts");

  useEffect(() => {
    trackShop("shop_view");
    const aborter = new AbortController();
    let failures = 0;
    for (const c of COLLECTIONS) {
      void fetchCollectionProducts(c.handle, { signal: aborter.signal })
        .then((products) => {
          setSlots((prev) => ({
            ...prev,
            [c.handle]: { status: "ready", products: applyPinnedOrder(products) },
          }));
        })
        .catch(() => {
          setSlots((prev) => ({ ...prev, [c.handle]: { status: "error" } }));
          failures += 1;
          // Every named collection failed → try Fourthwall's built-in "all"
          // catch-all once, so a handle rename can't blank the whole shop.
          if (failures === COLLECTIONS.length) {
            void fetchCollectionProducts(ALL_COLLECTION_HANDLE, { signal: aborter.signal })
              .then((products) => setAllFallback(applyPinnedOrder(products)))
              .catch(() => {});
          }
        });
    }
    return () => aborter.abort();
  }, []);

  // Featured: curated picks when configured, else the first available
  // shirts/hoodies (the flagship garments) once those collections load.
  const featured = useMemo<readonly ShopProduct[]>(() => {
    const loaded: ShopProduct[] = [];
    for (const c of COLLECTIONS) {
      const slot = slots[c.handle];
      if (slot.status === "ready") loaded.push(...slot.products);
    }
    if (CURATION.featuredSlugs.length > 0) {
      const bySlug = new Map(loaded.map((p) => [p.slug, p]));
      return CURATION.featuredSlugs
        .map((slug) => bySlug.get(slug))
        .filter((p): p is ShopProduct => p !== undefined);
    }
    const auto: ShopProduct[] = [];
    for (const handle of ["shirts", "hoodies"] as const) {
      const slot = slots[handle];
      if (slot.status !== "ready") continue;
      auto.push(...slot.products.filter((p) => p.available && p.image !== null).slice(0, 2));
    }
    return auto;
  }, [slots]);

  const activeCollection = COLLECTIONS.find((c) => c.handle === active)!;
  const activeSlot = slots[active];
  const promo = CURATION.promo;

  return (
    <div className="eu-shop">
      {/* ---- Hero --------------------------------------------------------- */}
      <section className="eu-shop-hero">
        <p className="eu-shop-hero__eyebrow">The Shop</p>
        <h1 className="eu-shop-hero__title">Euphoria Merch</h1>
        <p className="eu-shop-hero__copy">
          Rep the factions. Support the manga. Enter the world.
        </p>
      </section>

      {/* ---- Promo / discount callout (curation-driven) ------------------- */}
      {promo !== null && (
        <aside className="eu-shop-promo">
          <p className="eu-shop-promo__headline">{promo.headline}</p>
          <p className="eu-shop-promo__body">
            {promo.body}
            {promo.code !== undefined && (
              <>
                {" "}
                <code className="eu-shop-promo__code">{promo.code}</code>
              </>
            )}
          </p>
          {promo.url !== undefined && (
            <a className="eu-shop-link" href={promo.url} target="_blank" rel="noreferrer">
              Shop the offer →
            </a>
          )}
        </aside>
      )}

      {/* ---- Collection tabs ---------------------------------------------- */}
      <nav className="eu-shop-tabs" aria-label="Merch collections">
        {COLLECTIONS.map((c) => (
          <button
            key={c.handle}
            type="button"
            className={`eu-shop-tab${c.handle === active ? " is-active" : ""}`}
            style={tone(c)}
            aria-pressed={c.handle === active}
            onClick={() => {
              setActive(c.handle);
              trackShop("shop_collection_click", { collection: c.handle });
            }}
          >
            {c.title}
          </button>
        ))}
      </nav>

      {/* ---- Featured drops ------------------------------------------------ */}
      {featured.length >= 2 && (
        <section className="eu-shop-section" aria-label="Featured products">
          <h2 className="eu-shop-section__title">Featured Drops</h2>
          <div className="eu-shop-grid eu-shop-grid--featured">
            {featured.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Active collection --------------------------------------------- */}
      <section className="eu-shop-section" aria-label={activeCollection.title}>
        <h2 className="eu-shop-section__title">{activeCollection.title}</h2>
        <p className="eu-shop-section__blurb">{activeCollection.blurb}</p>
        {activeSlot.status === "loading" && (
          <div className="eu-shop-grid" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="eu-shop-card eu-shop-card--skeleton" />
            ))}
          </div>
        )}
        {activeSlot.status === "ready" &&
          (activeSlot.products.length > 0 ? (
            <div className="eu-shop-grid">
              {activeSlot.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <CollectionFallbackCard collection={activeCollection}>
              New drops land here soon — browse the collection on our shop.
            </CollectionFallbackCard>
          ))}
        {activeSlot.status === "error" &&
          (allFallback !== null && allFallback.length > 0 ? (
            <div className="eu-shop-grid">
              {allFallback.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <CollectionFallbackCard collection={activeCollection}>
              The live catalog is taking a breather. Everything is still up on
              our shop — same gear, same checkout.
            </CollectionFallbackCard>
          ))}
      </section>

      {/* ---- Fallback rack: every collection, always reachable ------------- */}
      <section className="eu-shop-section" aria-label="All collections">
        <h2 className="eu-shop-section__title eu-shop-section__title--quiet">
          Browse by collection
        </h2>
        <div className="eu-shop-collections">
          {COLLECTIONS.map((c) => (
            <a
              key={c.handle}
              className="eu-shop-collection"
              style={tone(c)}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                trackShop("shop_collection_click", { collection: c.handle, url: c.url })
              }
            >
              <span className="eu-shop-collection__title">{c.title}</span>
              <span className="eu-shop-collection__blurb">{c.blurb}</span>
              <span className="eu-shop-collection__cta">Open on Fourthwall →</span>
            </a>
          ))}
        </div>
      </section>

      {/* ---- Bottom CTA ----------------------------------------------------- */}
      <section className="eu-shop-outro">
        <h2 className="eu-shop-outro__title">
          Play the beta. Join the list. Support the launch.
        </h2>
        <div className="eu-shop-outro__ctas">
          <a href={BETA_URL} className="hub-btn hub-btn--primary">
            Play the Beta
          </a>
          <Link to="/#dispatch" className="hub-btn hub-btn--ghost">
            Join the Dispatch
          </Link>
          <a
            href={SHOP_DOMAIN}
            target="_blank"
            rel="noreferrer"
            className="hub-btn hub-btn--ghost"
            onClick={() => trackShop("shop_collection_click", { collection: "shop-home", url: SHOP_DOMAIN })}
          >
            Full Shop
          </a>
        </div>
      </section>
    </div>
  );
}

/** One product: image + name link to Fourthwall; Buy is its own tracked CTA. */
function ProductCard({ product }: { readonly product: ShopProduct }) {
  const typeLabel =
    COLLECTIONS.find((c) => c.handle === product.collection)?.title ?? "Merch";
  const onProduct = (): void =>
    trackShop("shop_product_click", {
      product: product.slug,
      collection: product.collection,
      url: product.url,
    });
  const onBuy = (): void =>
    trackShop("shop_buy_click", {
      product: product.slug,
      collection: product.collection,
      url: product.url,
    });
  return (
    <article className={`eu-shop-card${product.available ? "" : " is-soldout"}`}>
      <a
        className="eu-shop-card__media"
        href={product.url}
        target="_blank"
        rel="noreferrer"
        onClick={onProduct}
        aria-label={product.name}
      >
        {product.image !== null ? (
          <img
            src={product.image.url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            width={product.image.width}
            height={product.image.height}
          />
        ) : (
          <span className="eu-shop-card__noart" aria-hidden="true">
            EUPHORIA
          </span>
        )}
        {!product.available && <span className="eu-shop-card__badge">Sold out</span>}
      </a>
      <div className="eu-shop-card__info">
        <p className="eu-shop-card__type">{typeLabel}</p>
        <h3 className="eu-shop-card__name">
          <a href={product.url} target="_blank" rel="noreferrer" onClick={onProduct}>
            {product.name}
          </a>
        </h3>
        {product.blurb !== "" && <p className="eu-shop-card__blurb">{product.blurb}</p>}
        <p className="eu-shop-card__price">
          {product.price !== null ? (
            <>
              {product.compareAtPrice !== null && (
                <s className="eu-shop-card__compare">{formatPrice(product.compareAtPrice)}</s>
              )}
              <span>{formatPrice(product.price)}</span>
            </>
          ) : (
            <span className="eu-shop-card__price--none">See price on shop</span>
          )}
        </p>
        <a
          className="eu-shop-card__buy"
          href={product.url}
          target="_blank"
          rel="noreferrer"
          onClick={onBuy}
        >
          {product.available ? "Buy on Fourthwall →" : "View on Fourthwall →"}
        </a>
      </div>
    </article>
  );
}

/** Graceful degrade: a collection card that links to the hosted shop. */
function CollectionFallbackCard({
  collection,
  children,
}: {
  readonly collection: ShopCollection;
  readonly children: ReactNode;
}) {
  return (
    <a
      className="eu-shop-collection eu-shop-collection--wide"
      style={tone(collection)}
      href={collection.url}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackShop("shop_collection_click", {
          collection: collection.handle,
          url: collection.url,
        })
      }
    >
      <span className="eu-shop-collection__title">{collection.title}</span>
      <span className="eu-shop-collection__blurb">{children}</span>
      <span className="eu-shop-collection__cta">Shop {collection.title} on Fourthwall →</span>
    </a>
  );
}
