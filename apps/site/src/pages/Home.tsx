import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { cards, cardImageUrl, cardThumbUrl } from "@euphoria/core/cards";
import { BETA_URL } from "../beta";
import { InterestForm } from "../signup/InterestForm";
import { STARTER_MARKERS, factionColor, type MapMarker } from "../map/markers";

const BASE = import.meta.env.BASE_URL;
/**
 * Mobile rehab: the hub loads LIGHT assets — the ~150KB downscaled map teaser
 * (not the 2.8MB full map) and ~60KB optimized card thumbs (not the ~3MB full
 * PNGs, which stalled and blanked the homepage on mobile connections). The
 * full-size art stays exactly where it belongs: card inspect and the real map.
 */
const MAP_TEASER_SRC = `${BASE}maps/euphoria-base-map-teaser.webp`;

/**
 * The three "cabinet" cards in the beta promo: one striking Warrior per
 * featured faction, resolved from the live pool so the art always exists.
 */
const CABINET_FACTIONS = ["Monk", "Sonic", "Dwarf"] as const;
const cabinetCards = CABINET_FACTIONS.map(
  (faction) =>
    cards.find((c) => c.faction === faction && c.type === "Warrior") ?? cards[0]!,
);

/**
 * The four-nation strip: graffiti faction emblems as portal banners. Dwarves,
 * Monks, and Surfers link to their archive files; the Sonic archive entry
 * isn't written yet, so Sonics deep-link to their card set until it lands.
 * Shamans are deliberately absent — they are an anomaly, not a nation tile.
 */
const FACTION_TILES = [
  {
    name: "Dwarves",
    tone: "green",
    img: "dwarf_faction.webp",
    line: "Strength, faith, and the weight of prosperity.",
    to: "/blog/dwarves",
    ctaLabel: "Read the file",
  },
  {
    name: "Monks",
    tone: "red",
    img: "monk_faction.webp",
    line: "Discipline, fire, empire, and inherited trauma.",
    to: "/blog/monks",
    ctaLabel: "Read the file",
  },
  {
    name: "Surfers",
    tone: "blue",
    img: "surfer_faction.webp",
    line: "A wounded ocean nation fighting collapse from within.",
    to: "/blog/surfers",
    ctaLabel: "Read the file",
  },
  {
    name: "Sonics",
    tone: "yellow",
    img: "sonic_faction.webp",
    line: "Isolation, intelligence, energy, and quiet control.",
    to: "/cards?faction=Sonic",
    ctaLabel: "See the cards",
  },
] as const;

/** Map-teaser pins: a few landmark markers, positioned by their real coords. */
const TEASER_MARKER_IDS = ["musa", "metallstadt", "burne", "marina"] as const;
/** The base map's natural size (the starter markers' coordinate space). */
const MAP_W = 1122;
const MAP_H = 1402;
const teaserMarkers: MapMarker[] = TEASER_MARKER_IDS.map((id) =>
  STARTER_MARKERS.find((m) => m.id === id),
).filter((m): m is MapMarker => m !== undefined);

/**
 * The Euphoria Universe hub (ux-reboot Phase C). Not a marketing page — a
 * game-menu-style set of portals into the three destinations (Play, World,
 * Manga) plus the founder/Kickstarter and shop beats. Every section is a
 * diagonal "broadcast" panel on the shared dark stage; color only ever
 * appears as faction energy (fx-tokens.css).
 */
export function Home() {
  return (
    <div className="hub">
      {/* ---- Hero: the dark stage --------------------------------------- */}
      <section className="hub-hero">
        <div className="hub-hero__sweep" aria-hidden="true" />
        <p className="hub-hero__eyebrow">The Euphoria Universe</p>
        <h1 className="hub-hero__logo">
          <img
            src={`${BASE}images/brand/euphoria.webp`}
            alt="Euphoria"
            width={1200}
            height={514}
            decoding="async"
            fetchPriority="high"
          />
        </h1>
        <p className="hub-hero__title hub-hero__tagline">
          A world at war.{" "}
          <span className="hub-hero__title-accent">A game in your hands.</span>
        </p>
        <p className="hub-hero__lede">
          A trading card game, a manga, and an explorable world — one
          high-energy universe. The beta is live. The map is open. The story is
          coming.
        </p>
        <div className="hub-hero__ctas">
          <a href={BETA_URL} className="hub-btn hub-btn--primary">
            Play the Beta
          </a>
          <Link to="/map" className="hub-btn hub-btn--ghost">
            Explore the World
          </Link>
        </div>
      </section>

      {/* ---- Beta promo: playable now ------------------------------------ */}
      <section className="hub-panel hub-panel--beta" aria-label="TCG beta">
        <div className="hub-panel__media hub-cabinets" aria-hidden="true">
          {cabinetCards.map((card, i) => (
            <figure
              key={card.id}
              className={`hub-cabinet hub-cabinet--${i + 1}`}
              style={
                {
                  "--energy": `var(--eu-energy-${card.faction.toLowerCase()}, var(--eu-energy-neutral))`,
                } as CSSProperties
              }
            >
              <img
                src={cardThumbUrl(card, BASE)}
                alt=""
                loading="lazy"
                decoding="async"
                width={420}
                height={588}
                onError={(e) => {
                  // Thumb missing → fall back to the full art (once).
                  const img = e.currentTarget;
                  const full = cardImageUrl(card, BASE);
                  if (img.src !== full) img.src = full;
                }}
              />
            </figure>
          ))}
        </div>
        <div className="hub-panel__copy">
          <p className="hub-chip hub-chip--live">
            <span className="hub-chip__dot" aria-hidden="true" /> LIVE
          </p>
          <h2 className="hub-panel__title">The TCG is playable now</h2>
          <p className="hub-panel__lede">
            Not a mockup — a live rules engine with a full battle client.
          </p>
          <ul className="hub-panel__list">
            <li>Full matches against the AI, on desktop and mobile</li>
            <li>Starter decks or your own builds — deck builder included</li>
            <li>Win milestones earn reward cards for your collection</li>
          </ul>
          <a href={BETA_URL} className="hub-btn hub-btn--primary">
            Play the Beta
          </a>
        </div>
      </section>

      {/* ---- World / map -------------------------------------------------- */}
      <section className="hub-panel hub-panel--world" aria-label="World map">
        <div className="hub-panel__copy">
          <p className="hub-panel__eyebrow">The World</p>
          <h2 className="hub-panel__title">Chart Euphoria</h2>
          <p className="hub-panel__lede">
            Nations, temples, criminal havens — an interactive map of the whole
            verse, with the lore behind every marker.
          </p>
          <Link to="/map" className="hub-btn hub-btn--ghost">
            Enter the World Map
          </Link>
        </div>
        <Link
          to="/map"
          className="hub-panel__media hub-map"
          aria-label="Open the interactive map"
        >
          <img
            src={MAP_TEASER_SRC}
            alt=""
            loading="lazy"
            decoding="async"
            width={900}
            height={1125}
            className="hub-map__img"
          />
          {teaserMarkers.map((m) => (
            <span
              key={m.id}
              className="hub-map__pin"
              style={
                {
                  left: `${((m.x / MAP_W) * 100).toFixed(2)}%`,
                  top: `${((m.y / MAP_H) * 100).toFixed(2)}%`,
                  "--pin": factionColor(m.factionAffinity[0] ?? "Neutral"),
                } as CSSProperties
              }
              aria-hidden="true"
            />
          ))}
        </Link>
      </section>

      {/* ---- Factions: the four nations ----------------------------------- */}
      <section className="hub-panel hub-panel--factions" aria-label="Factions">
        <div className="hub-panel__copy hub-panel__copy--center">
          <p className="hub-panel__eyebrow">The Factions</p>
          <h2 className="hub-panel__title">Four nations. One continent.</h2>
          <p className="hub-panel__lede">
            Every card, every border, every war traces back to them. Pick a
            nation and read its file.
          </p>
        </div>
        <div className="hub-factions">
          {FACTION_TILES.map((f) => (
            <Link
              key={f.name}
              to={f.to}
              className={`hub-faction hub-faction--${f.tone}`}
            >
              <img
                src={`${BASE}images/factions/${f.img}`}
                alt={`${f.name} faction emblem`}
                width={900}
                height={507}
                loading="lazy"
                decoding="async"
                className="hub-faction__logo"
              />
              <span className="hub-faction__line">{f.line}</span>
              <span className="hub-faction__cta">{f.ctaLabel} →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- Manga -------------------------------------------------------- */}
      <section className="hub-panel hub-panel--manga" aria-label="Manga">
        <div className="hub-panel__copy">
          <p className="hub-panel__eyebrow">The Story</p>
          <h2 className="hub-panel__title">Read the manga behind the game</h2>
          <p className="hub-panel__lede">
            Every card is a character. Every marker is a place in the story.
            The Euphoria manga is where the universe begins.
          </p>
          <Link to="/manga" className="hub-btn hub-btn--ghost">
            About the Manga
          </Link>
        </div>
        <div className="hub-ink" aria-hidden="true">
          <span className="hub-ink__panel hub-ink__panel--1" />
          <span className="hub-ink__panel hub-ink__panel--2" />
          <span className="hub-ink__panel hub-ink__panel--3" />
        </div>
      </section>

      {/* ---- The Euphoria Dispatch (email capture) ------------------------- */}
      <section className="hub-panel hub-panel--founders" aria-label="Email list">
        <div className="hub-panel__copy hub-panel__copy--center">
          <p className="hub-panel__eyebrow hub-panel__eyebrow--gold">
            The Dispatch
          </p>
          <h2 className="hub-panel__title">Join the Euphoria Dispatch</h2>
          <p className="hub-panel__lede">
            Get beta updates, chapter drops, faction archives, merch releases,
            and Kickstarter announcements before they go public.
          </p>
          <InterestForm source="home" submitLabel="Join the List" />
        </div>
      </section>

      {/* ---- Shop teaser --------------------------------------------------- */}
      <section className="hub-panel hub-panel--shop" aria-label="Shop">
        <div className="hub-shop-card">
          <span className="hub-shop-card__spine" aria-hidden="true" />
          <div>
            <p className="hub-panel__eyebrow">The Shop</p>
            <h2 className="hub-panel__title hub-panel__title--sm">
              Volume 1 · Coming soon
            </h2>
            <p className="hub-panel__lede">
              Print and gear arrive after the campaign. Until then, the beta and
              the founder list are the best ways to back the universe.
            </p>
            <Link to="/shop" className="hub-btn hub-btn--ghost hub-btn--sm">
              Visit the Shop
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
