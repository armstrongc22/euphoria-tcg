/**
 * @vitest-environment jsdom
 *
 * Rules page rendering. Exercises the pure renderRules builder over the static
 * copy in rules.ts, and asserts the verified beta facts are present.
 */
import { describe, expect, it } from "vitest";
import { renderRules } from "../src/rules-view";
import { RULES_SECTIONS, RULES_SUBTITLE, RULES_TITLE } from "../src/rules";

describe("renderRules", () => {
  it("renders the title and subtitle", () => {
    const el = renderRules();
    expect(el.querySelector(".page__title")?.textContent).toBe(RULES_TITLE);
    expect(el.querySelector(".page__subtitle")?.textContent).toBe(RULES_SUBTITLE);
  });

  it("renders every rules section heading", () => {
    const headings = Array.from(
      renderRules().querySelectorAll(".page__section-heading"),
    ).map((h) => h.textContent);
    for (const section of RULES_SECTIONS) {
      expect(headings).toContain(section.heading);
    }
  });

  it("includes the key verified beta rules", () => {
    const text = renderRules().textContent ?? "";
    expect(text).toContain("30-card deck");
    expect(text).toContain("3 Lives");
    expect(text).toContain("Spirit");
    expect(text).toContain("Warrior summon per turn");
    expect(text.toLowerCase()).toContain("rewards are based on wins");
  });

  it("states the verified reward cadence (every 5 wins)", () => {
    expect(renderRules().textContent ?? "").toContain("every 5 wins");
  });

  it("renders the Turn Flow as an ordered list", () => {
    const ordered = renderRules().querySelector("ol.page__list");
    expect(ordered).not.toBeNull();
    expect(ordered!.querySelectorAll("li").length).toBeGreaterThan(0);
  });
});
