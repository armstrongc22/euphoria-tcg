/**
 * @vitest-environment jsdom
 *
 * Lore page rendering. Exercises the pure renderLore builder over the static copy
 * in lore.ts, and asserts the required world entities are present.
 */
import { describe, expect, it } from "vitest";
import { renderLore } from "../src/lore-view";
import { LORE_SECTIONS, LORE_SUBTITLE, LORE_TITLE } from "../src/lore";

describe("renderLore", () => {
  it("renders the title and subtitle", () => {
    const el = renderLore();
    expect(el.querySelector(".page__title")?.textContent).toBe(LORE_TITLE);
    expect(el.querySelector(".page__subtitle")?.textContent).toBe(LORE_SUBTITLE);
  });

  it("renders every lore section heading", () => {
    const headings = Array.from(
      renderLore().querySelectorAll(".page__section-heading"),
    ).map((h) => h.textContent);
    for (const section of LORE_SECTIONS) {
      expect(headings).toContain(section.heading);
    }
  });

  it("includes all five races and the key characters", () => {
    const text = renderLore().textContent ?? "";
    for (const name of [
      "Surfers",
      "Monks",
      "Shamans",
      "Dwarves",
      "Sonics",
      "Najma",
      "Nexus",
      "Flamma",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("clarifies that Shamans are not a beta starter deck", () => {
    const text = renderLore().textContent ?? "";
    expect(text.toLowerCase()).toContain("not currently");
    expect(text).toContain("starter deck");
  });

  it("renders the Five Races as subsections", () => {
    const subs = renderLore().querySelectorAll(".page__subsection .page__subheading");
    const names = Array.from(subs).map((s) => s.textContent);
    expect(names).toEqual(
      expect.arrayContaining(["Surfers", "Monks", "Shamans", "Dwarves", "Sonics"]),
    );
  });
});
