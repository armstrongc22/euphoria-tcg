/**
 * Universe-hub smoke tests (ux-reboot Phase C): the Home hub renders all six
 * sections with working destinations, and the reworked Nav exposes the
 * Play/World/Manga trio, the secondary links, and the mobile menu button.
 * Rendered with react-dom/server (no DOM/browser needed) inside a MemoryRouter.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Home } from "../src/pages/Home";
import { Nav } from "../src/layout/Nav";

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("Home — the universe hub", () => {
  const html = render(<Home />);

  it("renders the hero with both primary destinations", () => {
    expect(html).toContain("hub-hero");
    expect(html).toContain("A world at war.");
    expect(html).toContain("Play the Beta");
    expect(html).toContain("Explore the World");
  });

  it("renders the beta promo with a LIVE chip and three card cabinets", () => {
    expect(html).toContain("hub-panel--beta");
    expect(html).toContain("hub-chip--live");
    expect((html.match(/hub-cabinet--/g) ?? []).length).toBe(3);
    // Mobile rehab: cabinets load the ~60KB optimized thumbs, NOT the ~3MB
    // full PNGs that stalled mobile connections.
    expect((html.match(/optimized\/[\w-]+\/[\w-]+\.webp/g) ?? []).length).toBe(3);
    expect(html).not.toContain('src="/monk/'); // no full-art srcs on the hub
  });

  it("renders the world section with the LIGHT map teaser and live marker pins", () => {
    expect(html).toContain("hub-panel--world");
    // Mobile rehab: the ~150KB teaser, not the 2.8MB full base map.
    expect(html).toContain("maps/euphoria-base-map-teaser.webp");
    expect(html).not.toContain("maps/euphoria-base-map.png");
    expect((html.match(/hub-map__pin/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('href="/map"');
  });

  it("renders manga, dispatch, and shop sections with their destinations", () => {
    expect(html).toContain("hub-panel--manga");
    expect(html).toContain('href="/manga"');
    expect(html).toContain("hub-panel--founders");
    expect(html).toContain("Euphoria Dispatch");
    expect(html).toContain("Kickstarter");
    expect(html).toContain("hub-panel--shop");
    expect(html).toContain("Volume 1");
    expect(html).toContain('href="/shop"');
  });

  it("puts the graffiti logo in the hero (optimized webp, not the 2.4MB png)", () => {
    expect(html).toContain("hub-hero__logo");
    expect(html).toContain("images/brand/euphoria.webp");
    expect(html).not.toContain("images/brand/euphoria.png");
    expect(html).toContain('alt="Euphoria"');
  });

  it("renders the four-nation faction strip with emblems and destinations", () => {
    expect(html).toContain("hub-panel--factions");
    expect((html.match(/hub-faction__logo/g) ?? []).length).toBe(4);
    for (const img of [
      "images/factions/dwarf_faction.webp",
      "images/factions/monk_faction.webp",
      "images/factions/surfer_faction.webp",
      "images/factions/sonic_faction.webp",
    ]) {
      expect(html).toContain(img);
    }
    expect(html).toContain('href="/blog/dwarves"');
    expect(html).toContain('href="/blog/monks"');
    expect(html).toContain('href="/blog/surfers"');
    expect(html).toContain('href="/cards?faction=Sonic"');
    // Shamans are an anomaly, never a nation tile.
    expect(html).not.toContain("shaman_faction");
  });
});

describe("BlogPost — faction banner", () => {
  it("shows the faction emblem on faction files but never on the Shamans page", async () => {
    const { BlogPost } = await import("../src/pages/BlogPost");
    const page = (path: string): string =>
      renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/blog/:slug" element={<BlogPost />} />
          </Routes>
        </MemoryRouter>,
      );
    expect(page("/blog/dwarves")).toContain("images/factions/dwarf_faction.webp");
    expect(page("/blog/monks")).toContain("images/factions/monk_faction.webp");
    expect(page("/blog/surfers")).toContain("images/factions/surfer_faction.webp");
    const shamans = page("/blog/shamans");
    expect(shamans).not.toContain("images/factions/");
    expect(shamans).toContain("RESTRICTED");
  });
});

describe("Nav — hub rework", () => {
  const html = render(<Nav />);

  it("puts the Play / World / Manga trio first-class", () => {
    for (const [href, label] of [
      ["/play", "Play"],
      ["/map", "World"],
      ["/manga", "Manga"],
    ] as const) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect((html.match(/hub-nav__link--primary/g) ?? []).length).toBe(3);
  });

  it("keeps the secondary links and the beta CTA reachable", () => {
    expect((html.match(/hub-nav__link--secondary/g) ?? []).length).toBe(3);
    expect(html).toContain('href="/cards"');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('href="/blog"');
    expect(html).toContain("Play Beta");
  });

  it("exposes the mobile menu button, sheet closed by default", () => {
    expect(html).toContain("hub-nav__menu");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("hub-sheet-backdrop");
  });
});
