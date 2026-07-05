import { Link } from "react-router-dom";
import { BLOG_POSTS } from "../blog/posts";

/**
 * Blog index — the post feed for the Euphoria Universe blog. Every entry
 * links to /blog/:slug; the restricted Shaman file gets a distinct
 * "classified" card treatment instead of a normal summary card.
 */
export function Blog() {
  return (
    <div className="eu-page eu-page--blue">
      <p className="eu-page__eyebrow">Updates &amp; Lore</p>
      <h1 className="eu-page__title">Blog</h1>
      <div className="eu-page__body">
        <p>
          Dispatches from the world of Euphoria — faction files, location
          files, and letters from the founder.
        </p>
      </div>

      <div className="eu-blog-feed">
        {BLOG_POSTS.map((post) =>
          post.kind === "restricted" ? (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="eu-blog-item eu-blog-item--restricted"
            >
              <p className="eu-blog-item__eyebrow">
                Entry {String(post.number).padStart(2, "0")} · {post.eyebrow}
              </p>
              <h2 className="eu-blog-item__title">
                {post.title}
                <span className="eu-blog-item__lock" aria-hidden="true">
                  RESTRICTED
                </span>
              </h2>
              <p className="eu-blog-item__summary eu-blog-item__summary--mono">
                {post.summary}
              </p>
              <span className="eu-blog-item__cta">Open file →</span>
            </Link>
          ) : (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className={`eu-blog-item eu-blog-item--${post.tone}`}
            >
              <p className="eu-blog-item__eyebrow">
                Entry {String(post.number).padStart(2, "0")} · {post.eyebrow}
              </p>
              <h2 className="eu-blog-item__title">{post.title}</h2>
              <p className="eu-blog-item__summary">{post.summary}</p>
              <span className="eu-blog-item__cta">Read →</span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
