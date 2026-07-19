import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Link, useLocation } from "react-router-dom";
import { BETA_URL } from "../beta";

/** The three destinations the hub is built around (ux-reboot Phase C). */
const PRIMARY: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/play", label: "Play" },
  { to: "/map", label: "World" },
  { to: "/manga", label: "Manga" },
];

/** Everything else stays one click away, just quieter. */
const SECONDARY: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/cards", label: "Cards" },
  { to: "/shop", label: "Shop" },
  { to: "/blog", label: "Blog" },
];

/**
 * The mobile sheet carries the FULL site navigation (mobile rehab): the three
 * big destination panels, then the quiet row — Home first, and the Founder
 * list (which lives on the Manga page's Kickstarter section).
 */
const SHEET_MINOR: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Home" },
  ...SECONDARY,
  { to: "/manga#kickstarter", label: "Founder List" },
];

/**
 * Top navigation: brand mark left, the Play / World / Manga trio center (with
 * the quieter secondary links beside them on desktop), and the Play Beta
 * energy button right. Compresses to a hairline once the page scrolls. On
 * small screens the links collapse behind a menu button that opens a
 * bottom-sheet of large diagonal panels (game-menu, thumb-first) — closed on
 * navigation, Escape, or the backdrop.
 */
export function Nav() {
  const [condensed, setCondensed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = (): void => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Any navigation closes the sheet (a link was chosen). location.key changes
  // on every navigation, including hash-only ones like /manga#kickstarter.
  useEffect(() => setSheetOpen(false), [location.key]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  return (
    <header className={"eu-nav hub-nav" + (condensed ? " hub-nav--condensed" : "")}>
      <Link to="/" className="eu-nav__brand" aria-label="Euphoria Universe home">
        <span className="eu-nav__brand-mark">EUPHORIA</span>
        <span className="eu-nav__brand-sub">UNIVERSE</span>
      </Link>
      <nav className="eu-nav__links hub-nav__links" aria-label="Primary">
        {PRIMARY.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              "eu-nav__link hub-nav__link hub-nav__link--primary" +
              (isActive ? " eu-nav__link--active" : "")
            }
          >
            {link.label}
          </NavLink>
        ))}
        <span className="hub-nav__divider" aria-hidden="true" />
        {SECONDARY.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              "eu-nav__link hub-nav__link hub-nav__link--secondary" +
              (isActive ? " eu-nav__link--active" : "")
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <a href={BETA_URL} className="eu-btn eu-btn--sm eu-btn--red eu-nav__cta hub-nav__cta">
        Play Beta
      </a>
      <button
        type="button"
        className="hub-nav__menu"
        aria-expanded={sheetOpen}
        aria-controls="hub-sheet"
        onClick={() => setSheetOpen((open) => !open)}
      >
        {sheetOpen ? "Close" : "Menu"}
      </button>

      {/* The sheet is PORTALED to <body>: .eu-nav's backdrop-filter makes the
          header a containing block for position:fixed, which used to clip the
          whole menu into the header strip (the "only Play the Beta" bug). */}
      {sheetOpen
        ? createPortal(
            <div className="hub-sheet-backdrop" onClick={() => setSheetOpen(false)}>
              <nav
                id="hub-sheet"
                className="hub-sheet"
                aria-label="Menu"
                onClick={(e) => e.stopPropagation()}
              >
                {PRIMARY.map((link, i) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={`hub-sheet__panel hub-sheet__panel--${i + 1}`}
                  >
                    {link.label}
                  </NavLink>
                ))}
                <div className="hub-sheet__row">
                  {SHEET_MINOR.map((link) => (
                    <NavLink
                      key={link.label}
                      to={link.to}
                      end={link.to === "/"}
                      className="hub-sheet__minor"
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
                <a href={BETA_URL} className="hub-btn hub-btn--primary hub-sheet__cta">
                  Play the Beta
                </a>
              </nav>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}
