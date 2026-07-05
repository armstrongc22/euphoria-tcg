import { Link, useParams } from "react-router-dom";
import { findPost, type BlogPost as Post } from "../blog/posts";

/**
 * Single blog post page (/blog/:slug). Articles render as a polished
 * long-form reading page; the Shaman entry renders as a restricted/corrupted
 * archive file — deliberately NO lore body, the withheld information is the
 * worldbuilding (see /content/blog-source-documents/README.md).
 */
export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug !== undefined ? findPost(slug) : undefined;

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

  return (
    <article className={`eu-page eu-page--${post.tone} eu-post`}>
      <p className="eu-page__eyebrow">
        <Link to="/blog" className="eu-post__back">
          Blog
        </Link>{" "}
        · Entry {String(post.number).padStart(2, "0")} · {post.eyebrow}
      </p>
      <h1 className="eu-page__title">{post.title}</h1>
      <div className="eu-post__body">
        {(post.blocks ?? []).map((block, i) => {
          switch (block.kind) {
            case "h2":
              return (
                <h2 key={i} className="eu-post__heading">
                  {block.text}
                </h2>
              );
            case "pull":
              return (
                <p key={i} className={`eu-post__pull eu-post__pull--${post.tone}`}>
                  {block.text}
                </p>
              );
            default:
              return <p key={i}>{block.text}</p>;
          }
        })}
      </div>
      <footer className="eu-post__footer">
        <Link className="eu-btn eu-btn--blue eu-btn--ghost eu-btn--sm" to="/blog">
          ← All entries
        </Link>
      </footer>
    </article>
  );
}

/**
 * The Shaman special case: a full-bleed corrupted-archive page. Static TV
 * fuzz + scanlines + a violet distortion bloom, a distressed RESTRICTED
 * ARCHIVE stamp, and a terse intelligence-style notice. Polished and
 * intentional — never a normal faction primer.
 */
function RestrictedArchive({ post }: { readonly post: Post }) {
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

        <Link to="/blog" className="eu-restricted__exit">
          ← Return to unrestricted archive
        </Link>
      </div>
    </div>
  );
}
