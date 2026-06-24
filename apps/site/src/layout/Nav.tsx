import { NavLink, Link } from "react-router-dom";

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/play", label: "Play" },
  { to: "/cards", label: "Cards" },
  { to: "/manga", label: "Manga" },
  { to: "/shop", label: "Shop" },
  { to: "/blog", label: "Blog" },
  { to: "/map", label: "Map" },
];

/** Top navigation: brand mark + the six universe sections. */
export function Nav() {
  return (
    <header className="eu-nav">
      <Link to="/" className="eu-nav__brand" aria-label="Euphoria Universe home">
        <span className="eu-nav__brand-mark">EUPHORIA</span>
        <span className="eu-nav__brand-sub">UNIVERSE</span>
      </Link>
      <nav className="eu-nav__links" aria-label="Primary">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              "eu-nav__link" + (isActive ? " eu-nav__link--active" : "")
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Link to="/play" className="eu-btn eu-btn--sm eu-btn--red eu-nav__cta">
        Play Beta
      </Link>
    </header>
  );
}
