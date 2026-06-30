import { Link } from "react-router-dom";
import { InterestForm } from "../signup/InterestForm";

const SUPPORT: ReadonlyArray<{
  to: string;
  label: string;
  blurb: string;
  tone: string;
  cta: string;
}> = [
  {
    to: "#kickstarter",
    label: "Get Kickstarter updates",
    blurb:
      "Be first to know when the campaign goes live. Until then, every update lands on the blog.",
    tone: "purple",
    cta: "Join the list",
  },
  {
    to: "/shop",
    label: "Support through the shop",
    blurb:
      "Every purchase helps support Euphoria’s manga production and launch.",
    tone: "green",
    cta: "Visit the shop",
  },
  {
    to: "/play",
    label: "Play & share the TCG beta",
    blurb:
      "The game is live. Playing and sharing it grows the universe the manga lives in.",
    tone: "red",
    cta: "Play the beta",
  },
  {
    to: "/blog",
    label: "Follow development",
    blurb:
      "Lore drops, art direction, and progress updates as the universe takes shape.",
    tone: "blue",
    cta: "Read the blog",
  },
];

const PROOF: ReadonlyArray<{
  to: string;
  label: string;
  blurb: string;
  tone: string;
}> = [
  {
    to: "/cards",
    label: "The Cards",
    blurb: "A full faction-based card archive — the universe, already designed.",
    tone: "blue",
  },
  {
    to: "/play",
    label: "The TCG Beta",
    blurb: "A playable game with a live rules engine. Not a mockup — real.",
    tone: "red",
  },
  {
    to: "/blog",
    label: "Development Updates",
    blurb: "Follow the build in the open as the world comes together.",
    tone: "green",
  },
  {
    to: "/map",
    label: "The Map",
    blurb: "An explorable view of the Euphoria worlds — in development.",
    tone: "white",
  },
];

/**
 * /manga — a pre-launch support & conversion page. There is no published manga
 * yet, so this page never presents chapters as readable; it positions Euphoria
 * as a manga-first universe being built through the TCG, merch, and community
 * support, and drives Kickstarter interest / shop support / TCG traffic. No
 * publication or campaign dates, pricing, names, or guarantees are claimed.
 */
export function Manga() {
  return (
    <div className="eu-page eu-page--purple eu-manga">
      <section className="eu-manga__hero">
        <p className="eu-hero__eyebrow">A manga-first universe</p>
        <h1 className="eu-manga__title">
          Help bring Euphoria <span className="eu-manga__accent">to manga</span>.
        </h1>
        <p className="eu-manga__lede">
          Euphoria is a high-contrast manga universe being built in the open —
          through a playable trading card game, merch, and a founding community.
          Before the first chapter drops, the universe is already moving. Get in
          early and help push it to production.
        </p>
        <div className="eu-hero__ctas">
          <a href="#kickstarter" className="eu-btn eu-btn--red">
            Get Kickstarter Updates
          </a>
          <Link to="/shop" className="eu-btn eu-btn--blue eu-btn--ghost">
            Support Through the Shop
          </Link>
          <Link to="/play" className="eu-btn eu-btn--blue eu-btn--ghost">
            Play the TCG Beta
          </Link>
        </div>
      </section>

      <section className="eu-manga__section">
        <h2 className="eu-section-title">The Vision</h2>
        <p className="eu-manga__body">
          Euphoria is planned as a serialized manga built around five warring
          factions, supernatural power systems, and the conflicts that bind them.
          It’s a connected universe by design: the same factions, characters, and
          lore that drive the story already power the trading card game. The manga
          is the heart of it — the cards, the map, and the merch are all windows
          into the same world.
        </p>
      </section>

      <section className="eu-manga__section">
        <h2 className="eu-section-title">Why Support Matters</h2>
        <p className="eu-manga__body">
          A professional manga launch takes real production: original art and
          character development, chapter writing and pacing, and the printing and
          fulfillment prep that turns pages into something you can hold. Community
          support is what funds that work and gets the first chapters made — and
          early supporters are the ones who make it possible.
        </p>
      </section>

      <section className="eu-manga__section">
        <h2 className="eu-section-title">How to Support</h2>
        <div className="eu-cta-grid">
          {SUPPORT.map((item) =>
            item.to.startsWith("#") ? (
              <a
                key={item.label}
                href={item.to}
                className={`eu-card eu-card--${item.tone}`}
              >
                <span className="eu-card__label">{item.label}</span>
                <span className="eu-card__blurb">{item.blurb}</span>
                <span className="eu-manga__card-cta">{item.cta} →</span>
              </a>
            ) : (
              <Link
                key={item.label}
                to={item.to}
                className={`eu-card eu-card--${item.tone}`}
              >
                <span className="eu-card__label">{item.label}</span>
                <span className="eu-card__blurb">{item.blurb}</span>
                <span className="eu-manga__card-cta">{item.cta} →</span>
              </Link>
            ),
          )}
        </div>
      </section>

      <section className="eu-manga__kickstarter" id="kickstarter">
        <p className="eu-manga__ks-eyebrow">Kickstarter — in development</p>
        <h2 className="eu-manga__ks-title">The campaign is being built.</h2>
        <p className="eu-manga__body">
          A Kickstarter campaign for the Euphoria manga is in development. It isn’t
          live yet — this is the place to get in before it is. Add your email and
          you’ll know the moment it goes live.
        </p>
        <InterestForm source="kickstarter" />
        <p className="eu-manga__ks-secondary">
          Prefer to lurk? <Link to="/blog">Follow development on the blog →</Link>
        </p>
      </section>

      <section className="eu-manga__section">
        <h2 className="eu-section-title">The Shop Supports the Manga</h2>
        <p className="eu-manga__body">
          The shop isn’t just merch — it’s fuel. Every purchase helps support
          Euphoria’s manga production and launch, from art to printing prep.
          Wearing the universe helps build it.
        </p>
        <Link to="/shop" className="eu-btn eu-btn--green">
          Support Through the Shop
        </Link>
      </section>

      <section className="eu-manga__section">
        <h2 className="eu-section-title">The Universe Is Already Being Built</h2>
        <p className="eu-manga__body">
          This isn’t a pitch for an idea — it’s an invitation into a world that’s
          already in motion. Play the TCG. Study the factions. Support the manga.
        </p>
        <div className="eu-cta-grid eu-manga__proof">
          {PROOF.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`eu-card eu-card--${item.tone}`}
            >
              <span className="eu-card__label">{item.label}</span>
              <span className="eu-card__blurb">{item.blurb}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
