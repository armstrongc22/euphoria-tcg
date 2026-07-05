import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adjacentPosts, BLOG_POSTS, findPost } from "../src/blog/posts";

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
