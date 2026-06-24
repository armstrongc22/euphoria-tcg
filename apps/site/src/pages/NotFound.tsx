import { Link } from "react-router-dom";

/** Catch-all 404 page. */
export function NotFound() {
  return (
    <div className="eu-page eu-page--red">
      <p className="eu-page__eyebrow">Lost in the verse</p>
      <h1 className="eu-page__title">404</h1>
      <p className="eu-page__body">That path doesn&apos;t exist (yet).</p>
      <Link to="/" className="eu-btn eu-btn--red">
        Return home
      </Link>
    </div>
  );
}
