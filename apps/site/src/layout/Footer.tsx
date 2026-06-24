import { Link } from "react-router-dom";

/** Site footer: faction accent bar, section links, and a beta note. */
export function Footer() {
  return (
    <footer className="eu-footer">
      <div className="eu-footer__accents" aria-hidden="true">
        <span className="eu-accent eu-accent--red" />
        <span className="eu-accent eu-accent--blue" />
        <span className="eu-accent eu-accent--white" />
        <span className="eu-accent eu-accent--green" />
        <span className="eu-accent eu-accent--purple" />
      </div>
      <div className="eu-footer__row">
        <span className="eu-footer__brand">Euphoria Universe</span>
        <nav className="eu-footer__links" aria-label="Footer">
          <Link to="/play">Play</Link>
          <Link to="/cards">Cards</Link>
          <Link to="/manga">Manga</Link>
          <Link to="/shop">Shop</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/map">Map</Link>
        </nav>
        <span className="eu-footer__note">Beta · worlds in progress</span>
      </div>
    </footer>
  );
}
