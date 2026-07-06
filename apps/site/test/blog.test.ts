import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adjacentPosts, BLOG_POSTS, findPost } from "../src/blog/posts";
import { findCardByName, resolveFeaturedCards } from "../src/blog/featured";

const SOURCE_DIR = fileURLToPath(
  new URL("../../../content/blog-source-documents/", import.meta.url),
);

describe("blog posts", () => {
  it("has unique slugs and sequential entry numbers", () => {
    const slugs = BLOG_POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(BLOG_POSTS.map((p) => p.number)).toEqual(
      [...BLOG_POSTS].map((_, i) => i + 1),
    );
  });

  it("uses clean URL-safe slugs", () => {
    for (const post of BLOG_POSTS) {
      expect(post.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every article has body blocks; restricted entries have none", () => {
    for (const post of BLOG_POSTS) {
      if (post.kind === "article") {
        expect(post.blocks, post.slug).toBeDefined();
        expect(post.blocks!.length, post.slug).toBeGreaterThan(2);
      } else {
        // The Shaman rule: no lore body may ever be attached to a
        // restricted entry — the withheld information is the worldbuilding.
        expect(post.blocks, post.slug).toBeUndefined();
      }
    }
  });

  it("the Shamans entry is the restricted archive", () => {
    const shamans = findPost("shamans");
    expect(shamans?.kind).toBe("restricted");
    expect(shamans?.tone).toBe("purple");
  });

  it("each post's source .docx exists in content/blog-source-documents", () => {
    for (const post of BLOG_POSTS) {
      expect(
        existsSync(SOURCE_DIR + post.sourceDoc),
        `${post.sourceDoc} missing from ${SOURCE_DIR}`,
      ).toBe(true);
    }
  });

  it("findPost returns undefined for unknown slugs", () => {
    expect(findPost("sonic")).toBeUndefined();
  });

  it("every post has a CTA; article CTAs carry 2-3 links", () => {
    for (const post of BLOG_POSTS) {
      expect(post.cta, post.slug).toBeDefined();
      expect(post.cta!.links.length, post.slug).toBeGreaterThanOrEqual(2);
      expect(post.cta!.links.length, post.slug).toBeLessThanOrEqual(3);
    }
  });

  it("every featured card exists in the shared card data (exact name match)", () => {
    for (const post of BLOG_POSTS) {
      for (const f of post.featuredCards ?? []) {
        expect(findCardByName(f.name), `${post.slug}: "${f.name}"`).toBeDefined();
      }
      // Resolution must not silently drop any listed card.
      expect(resolveFeaturedCards(post.featuredCards ?? []).length).toBe(
        (post.featuredCards ?? []).length,
      );
    }
  });

  it("featured cards match their page's faction unless flagged as a lore exception", () => {
    const pageFaction: Record<string, string> = {
      dwarves: "Dwarf",
      monks: "Monk",
      surfers: "Surfer",
    };
    for (const post of BLOG_POSTS) {
      const faction = pageFaction[post.slug];
      if (faction === undefined) {
        // Non-faction pages (and the restricted Shamans entry) carry no cards.
        expect(post.featuredCards, post.slug).toBeUndefined();
        continue;
      }
      for (const f of post.featuredCards ?? []) {
        const card = findCardByName(f.name)!;
        if (f.loreException === true) {
          // Deliberate story-based exception — must actually be off-faction,
          // otherwise the flag is stale and should be removed.
          expect(card.faction, `${post.slug}: "${f.name}"`).not.toBe(faction);
        } else {
          expect(card.faction, `${post.slug}: "${f.name}"`).toBe(faction);
        }
      }
    }
    // The requested named cards are present on their pages; the dragon relic
    // rides on the Monk page as a flagged lore exception.
    const featured = (slug: string) => findPost(slug)!.featuredCards ?? [];
    expect(featured("dwarves").map((f) => f.name)).toContain("Aaron Alacapati");
    const dragon = featured("monks").find((f) => f.name === "A Dragon’s Judgement");
    expect(dragon?.loreException).toBe(true);
  });

  it("featured-card anchors point at real h2 headings in their post", () => {
    for (const post of BLOG_POSTS) {
      const headings = (post.blocks ?? [])
        .filter((b) => b.kind === "h2")
        .map((b) => b.text);
      for (const f of post.featuredCards ?? []) {
        if (f.anchor !== undefined) {
          expect(headings, `${post.slug}: anchor "${f.anchor}"`).toContain(f.anchor);
        }
      }
    }
  });

  it("the restricted Shamans entry stays muted: no cards, no beta, no command language", () => {
    const shamans = findPost("shamans")!;
    expect(shamans.featuredCards).toBeUndefined();
    expect(shamans.cta).toBeDefined();
    for (const link of shamans.cta!.links) {
      expect(link.to).not.toBe("beta");
      expect(link.label.toLowerCase()).not.toMatch(/command|play|shaman/);
    }
    expect(shamans.cta!.headline.toLowerCase()).not.toMatch(/command|beta|shaman/);
  });

  it("adjacentPosts walks the docket in order", () => {
    const first = BLOG_POSTS[0]!;
    const last = BLOG_POSTS[BLOG_POSTS.length - 1]!;
    expect(adjacentPosts(first.slug).prev).toBeUndefined();
    expect(adjacentPosts(first.slug).next?.slug).toBe(BLOG_POSTS[1]!.slug);
    expect(adjacentPosts(last.slug).next).toBeUndefined();
    expect(adjacentPosts("shamans").prev?.slug).toBe("surfers");
    expect(adjacentPosts("shamans").next?.slug).toBe("port-troy");
    expect(adjacentPosts("nope")).toEqual({ prev: undefined, next: undefined });
  });
});
