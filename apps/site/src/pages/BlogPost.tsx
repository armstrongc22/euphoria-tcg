import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adjacentPosts, findPost, type BlogPost as Post } from "../blog/posts";
import { BlogCta } from "../blog/BlogCta";
import { LoreCardAside } from "../blog/LoreCardAside";
import { resolveFeaturedCards } from "../blog/featured";
import { CardDetailModal } from "../cards/CardDetailModal";
import type { Card } from "../cards/types";
import { usePageTitle } from "../usePageTitle";
import { BETA_URL } from "../beta";

const entryNo = (post: Post) => String(post.number).padStart(2, "0");

/**
 * Graffiti faction emblems shown as the banner/hero of each faction file
 * (public/images/factions, optimized webp). Keyed by slug so the restricted
 * Shamans entry can never pick one up — its corrupted-archive treatment IS
 * its identity. "sonics" is pre-wired for when that archive entry lands.
 */
const FACTION_BANNERS: Record<string, { src: string; alt: string }> = {
  dwarves: { src: "images/factions/dwarf_faction.webp", alt: "Dwarf faction emblem" },
  monks: { src: "images/factions/monk_faction.webp", alt: "Monk faction emblem" },
  surfers: { src: "images/factions/surfer_faction.webp", alt: "Surfer faction emblem" },
  sonics: { src: "images/factions/sonic_faction.webp", alt: "Sonic faction emblem" },
};

/**
 * Single blog post page (/blog/:slug). Articles render as a polished
 * long-form reading page; the Shaman entry renders as a restricted/corrupted
 * archive file — deliberately NO lore body, the withheld information is the
 * worldbuilding (see /content/blog-source-documents/README.md).
 */
export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug !== undefined ? findPost(slug) : undefined;
  usePageTitle(post === undefined ? "Post not found" : post.title);

  if (post === undefined) {
    return (
      <div className="eu-page eu-page--blue">
        <p className="eu-page__eyebrow">Blog</p>
        <h1 className="eu-page__title">Post not found</h1>
        <div className="eu-page__body">
          <p>No entry lives at this address.</p>
          <Link className="eu-btn eu-btn--blue eu-btn--sm" to="/blog">
            ← Back to the blog
          </Link>
        </div>
      </div>
    );
  }

  if (post.kind === "restricted") return <RestrictedArchive post={post} />;

  return <ArticlePost post={post} />;
}

/**
 * Normal article layout. Featured cards render as editorial callouts woven
 * into the body: anchored cards follow their h2, unanchored ones follow the
 * lead paragraph. One shared detail modal serves every callout.
 */
function ArticlePost({ post }: { readonly post: Post }) {
  const [selected, setSelected] = useState<Card | null>(null);
  const featured = resolveFeaturedCards(post.featuredCards ?? []);
  const leadCards = featured.filter((f) => f.anchor === undefined);
  const cardsAfterHeading = (heading: string) =>
    featured.filter((f) => f.anchor === heading);

  let firstParagraphSeen = false;
  const banner = FACTION_BANNERS[post.slug];

  return (
    <article className={`eu-page eu-page--${post.tone} eu-post`}>
      {banner !== undefined && (
        <div className={`eu-post__banner eu-post__banner--${post.tone}`}>
          <img
            src={`${import.meta.env.BASE_URL}${banner.src}`}
            alt={banner.alt}
            width={900}
            height={507}
            decoding="async"
          />
        </div>
      )}
      <p className="eu-page__eyebrow">
        <Link to="/blog" className="eu-post__back">
          Blog
        </Link>{" "}
        · Entry {String(post.number).padStart(2, "0")} · {post.eyebrow}
      </p>
      <h1 className="eu-page__title">{post.title}</h1>
      <div className="eu-post__body">
        {(post.blocks ?? []).flatMap((block, i) => {
          switch (block.kind) {
            case "h2":
              return [
                <h2 key={i} className="eu-post__heading">
                  {block.text}
                </h2>,
                ...cardsAfterHeading(block.text).map((f) => (
                  <LoreCardAside key={`card-${f.card.id}`} card={f.card} onSelect={setSelected} />
                )),
              ];
            case "pull":
              return [
                <p key={i} className={`eu-post__pull eu-post__pull--${post.tone}`}>
                  {block.text}
                </p>,
              ];
            default: {
              const nodes = [<p key={i}>{block.text}</p>];
              if (!firstParagraphSeen) {
                firstParagraphSeen = true;
                nodes.push(
                  ...leadCards.map((f) => (
                    <LoreCardAside key={`card-${f.card.id}`} card={f.card} onSelect={setSelected} />
                  )),
                );
              }
              return nodes;
            }
          }
        })}
      </div>
      {post.cta !== undefined && <BlogCta cta={post.cta} tone={post.tone} />}
      {selected !== null && (
        <CardDetailModal card={selected} onClose={() => setSelected(null)} />
      )}
      <footer className="eu-post__footer">
        <DocketNav slug={post.slug} />
        <Link className="eu-btn eu-btn--blue eu-btn--ghost eu-btn--sm" to="/blog">
          ← All entries
        </Link>
      </footer>
    </article>
  );
}

/** Prev/next pagination between docket entries, shown on every post page. */
function DocketNav({ slug }: { readonly slug: string }) {
  const { prev, next } = adjacentPosts(slug);
  if (prev === undefined && next === undefined) return null;
  return (
    <nav className="eu-post__nav" aria-label="Blog entries">
      {prev !== undefined ? (
        <Link to={`/blog/${prev.slug}`} className="eu-post__nav-link">
          <span className="eu-post__nav-dir">← Entry {entryNo(prev)}</span>
          <span className="eu-post__nav-title">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next !== undefined ? (
        <Link
          to={`/blog/${next.slug}`}
          className="eu-post__nav-link eu-post__nav-link--next"
        >
          <span className="eu-post__nav-dir">Entry {entryNo(next)} →</span>
          <span className="eu-post__nav-title">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * The Shaman special case: a full-bleed corrupted-archive page. Static TV
 * fuzz + scanlines + a violet distortion bloom, a distressed RESTRICTED
 * ARCHIVE stamp, and a terse intelligence-style notice. Polished and
 * intentional — never a normal faction primer.
 */
function RestrictedArchive({ post }: { readonly post: Post }) {
  const { prev, next } = adjacentPosts(post.slug);
  return (
    <div className="eu-restricted" data-slug={post.slug}>
      <div className="eu-restricted__static" aria-hidden="true" />
      <div className="eu-restricted__scanlines" aria-hidden="true" />

      <div className="eu-restricted__readout eu-restricted__readout--tl" aria-hidden="true">
        <span>ARCHIVE STATUS: COMPROMISED</span>
        <span>CLASSIFICATION: EXTREME RISK</span>
      </div>
      <div className="eu-restricted__readout eu-restricted__readout--br" aria-hidden="true">
        <span>SIGNAL LOST</span>
        <span>FILE CORRUPTED</span>
      </div>

      <div className="eu-restricted__center">
        <p className="eu-restricted__file">
          EUPHORIAN ARCHIVE · ENTRY {String(post.number).padStart(2, "0")} ·
          SUBJECT: SHAMAN
        </p>

        <div className="eu-restricted__stamp" role="img" aria-label="Restricted archive">
          RESTRICTED
          <br />
          ARCHIVE
        </div>

        <p className="eu-restricted__denied" aria-hidden="true">
          ACCESS DENIED
        </p>

        <div className="eu-restricted__notice">
          <p>
            The contents of this page have been restricted, erased, or
            otherwise rendered inaccessible.
          </p>
          <p>
            What can be responsibly shared is that Shamans are as old as
            Euphoria itself.
          </p>
          <p>And the one truth that has followed them throughout history is this:</p>
        </div>

        <p className="eu-restricted__warning">
          IF YOU ARE FACE TO FACE WITH A SHAMAN, RUN.
        </p>

        {post.cta !== undefined && (
          <div className="eu-restricted__cta">
            <p className="eu-restricted__cta-head">{post.cta.headline}</p>
            <div className="eu-restricted__cta-links">
              {post.cta.links.map((link) =>
                link.to === "beta" ? (
                  <a
                    key={link.label}
                    href={BETA_URL}
                    className="eu-restricted__exit"
                  >
                    {link.label.toUpperCase()}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    to={link.to}
                    className="eu-restricted__exit"
                  >
                    {link.label.toUpperCase()}
                  </Link>
                ),
              )}
            </div>
          </div>
        )}

        <nav className="eu-restricted__nav" aria-label="Blog entries">
          {prev !== undefined && (
            <Link to={`/blog/${prev.slug}`} className="eu-restricted__exit">
              ← ENTRY {String(prev.number).padStart(2, "0")}
            </Link>
          )}
          {next !== undefined && (
            <Link to={`/blog/${next.slug}`} className="eu-restricted__exit">
              ENTRY {String(next.number).padStart(2, "0")} →
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
