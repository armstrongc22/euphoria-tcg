import { Link } from "react-router-dom";
import { BETA_URL } from "../beta";
import type { BlogCta as Cta, BlogTone } from "./posts";

interface BlogCtaProps {
  readonly cta: Cta;
  readonly tone: BlogTone;
}

/**
 * End-of-article CTA panel for normal blog posts. `to: "beta"` renders as a
 * real <a href> to the bundled beta (it's a separate static app, not a router
 * route); everything else is an internal <Link>. The restricted Shaman page
 * does NOT use this — it renders its own muted archive links.
 */
export function BlogCta({ cta, tone }: BlogCtaProps) {
  return (
    <aside className={`eu-post-cta eu-post-cta--${tone}`}>
      <h2 className="eu-post-cta__headline">{cta.headline}</h2>
      {cta.body !== undefined && <p className="eu-post-cta__body">{cta.body}</p>}
      <div className="eu-post-cta__links">
        {cta.links.map((link) =>
          link.to === "beta" ? (
            <a
              key={link.label}
              href={BETA_URL}
              className={`eu-btn eu-btn--sm ${link.primary === true ? "eu-btn--red" : "eu-btn--blue eu-btn--ghost"}`}
            >
              {link.label}
            </a>
          ) : (
            <Link
              key={link.label}
              to={link.to}
              className={`eu-btn eu-btn--sm ${link.primary === true ? "eu-btn--red" : "eu-btn--blue eu-btn--ghost"}`}
            >
              {link.label}
            </Link>
          ),
        )}
      </div>
    </aside>
  );
}
