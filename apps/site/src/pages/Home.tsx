import { Link } from "react-router-dom";

const CTAS: ReadonlyArray<{
  to: string;
  label: string;
  tone: string;
  blurb: string;
}> = [
  { to: "/play", label: "Play Beta", tone: "red", blurb: "Battle with the live TCG beta." },
  { to: "/cards", label: "Explore Cards", tone: "blue", blurb: "Browse the full card archive." },
  { to: "/manga", label: "Read Manga", tone: "purple", blurb: "Follow the Euphoria saga." },
  { to: "/shop", label: "Shop", tone: "green", blurb: "Gear from across the verse." },
  { to: "/map", label: "Explore Map", tone: "white", blurb: "Chart the Euphoria worlds." },
];

const FACTIONS: ReadonlyArray<{ name: string; tone: string }> = [
  { name: "Monk", tone: "red" },
  { name: "Sonic", tone: "blue" },
  { name: "Surfer", tone: "white" },
  { name: "Dwarf", tone: "green" },
  { name: "Shaman", tone: "purple" },
];

/** Landing page: cinematic hero, primary CTAs, and a faction strip. */
export function Home() {
  return (
    <div className="eu-home">
      <section className="eu-hero">
        <p className="eu-hero__eyebrow">The Euphoria Universe</p>
        <h1 className="eu-hero__title">
          Five factions. One <span className="eu-hero__accent">verse</span>.
        </h1>
        <p className="eu-hero__lede">
          A trading card game, a manga, and an explorable world — all part of the
          same high-contrast, anime-charged franchise. Jump into the beta, study
          the cards, and chart the map.
        </p>
        <div className="eu-hero__ctas">
          <Link to="/play" className="eu-btn eu-btn--red">
            Play Beta
          </Link>
          <Link to="/cards" className="eu-btn eu-btn--blue eu-btn--ghost">
            Explore Cards
          </Link>
        </div>
      </section>

      <section className="eu-cta-grid" aria-label="Enter the universe">
        {CTAS.map((cta) => (
          <Link
            key={cta.to}
            to={cta.to}
            className={`eu-card eu-card--${cta.tone}`}
          >
            <span className="eu-card__label">{cta.label}</span>
            <span className="eu-card__blurb">{cta.blurb}</span>
          </Link>
        ))}
      </section>

      <section className="eu-factions" aria-label="Factions">
        <h2 className="eu-section-title">The Factions</h2>
        <div className="eu-faction-strip">
          {FACTIONS.map((f) => (
            <span key={f.name} className={`eu-chip eu-chip--${f.tone}`}>
              {f.name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
