/**
 * @vitest-environment jsdom
 *
 * Mobile nav rehab: the menu sheet must carry the FULL site navigation and be
 * PORTALED to <body> — .eu-nav's backdrop-filter makes the header a containing
 * block for position:fixed, which used to clip the sheet into the header strip
 * (the "menu only shows Play the Beta" bug). Interactive: rendered with a real
 * React root and driven by clicks.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Nav } from "../src/layout/Nav";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function mountNav(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <MemoryRouter initialEntries={["/map"]}>
        <Nav />
      </MemoryRouter>,
    );
  });
  return host;
}

const openSheet = (host: HTMLElement): void => {
  const menu = host.querySelector<HTMLButtonElement>(".hub-nav__menu")!;
  act(() => menu.click());
};

describe("mobile menu sheet", () => {
  it("opens with the FULL navigation, portaled outside the header", () => {
    const host = mountNav();
    expect(document.body.querySelector(".hub-sheet-backdrop")).toBeNull();
    openSheet(host);

    const backdrop = document.body.querySelector(".hub-sheet-backdrop")!;
    expect(backdrop).not.toBeNull();
    // The portal: the sheet must NOT live inside the header element.
    expect(host.querySelector(".hub-sheet-backdrop")).toBeNull();

    const sheet = backdrop.querySelector(".hub-sheet")!;
    const links = [...sheet.querySelectorAll("a")].map((a) => [
      a.getAttribute("href"),
      a.textContent,
    ]);
    // Three big destination panels…
    expect(links).toContainEqual(["/play", "Play"]);
    expect(links).toContainEqual(["/map", "World"]);
    expect(links).toContainEqual(["/manga", "Manga"]);
    // …the quiet row with Home first + the founder list…
    expect(links).toContainEqual(["/", "Home"]);
    expect(links).toContainEqual(["/cards", "Cards"]);
    expect(links).toContainEqual(["/shop", "Shop"]);
    expect(links).toContainEqual(["/blog", "Blog"]);
    expect(links).toContainEqual(["/manga", "Founder List"]);
    // …and the beta CTA, prominent but not alone.
    expect(sheet.textContent).toContain("Play the Beta");
    expect(sheet.querySelectorAll("a").length).toBeGreaterThanOrEqual(9);
  });

  it("marks the active route and closes via the backdrop", () => {
    const host = mountNav();
    openSheet(host);
    // Mounted at /map: the World panel is the current page.
    const world = [...document.body.querySelectorAll(".hub-sheet__panel")].find(
      (a) => a.textContent === "World",
    )!;
    expect(world.getAttribute("aria-current")).toBe("page");
    act(() => {
      (document.body.querySelector(".hub-sheet-backdrop") as HTMLElement).click();
    });
    expect(document.body.querySelector(".hub-sheet-backdrop")).toBeNull();
  });

  it("toggles from the menu button (open, then Close)", () => {
    const host = mountNav();
    const menu = host.querySelector<HTMLButtonElement>(".hub-nav__menu")!;
    expect(menu.textContent).toBe("Menu");
    act(() => menu.click());
    expect(menu.textContent).toBe("Close");
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    act(() => menu.click());
    expect(document.body.querySelector(".hub-sheet-backdrop")).toBeNull();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
});
