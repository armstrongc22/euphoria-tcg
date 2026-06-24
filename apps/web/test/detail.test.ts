/**
 * Detail field-shaping tests. The DOM dialog is left to manual/visual check;
 * these cover the pure `cardDetailFields` derivation.
 */
import { describe, expect, it } from "vitest";
import { cards } from "@euphoria/core/cards";
import { cardDetailFields } from "../src/detail";

function bySlug(slug: string) {
  const card = cards.find((c) => c.slug === slug);
  if (card === undefined) throw new Error(`missing test card: ${slug}`);
  return card;
}

const labels = (slug: string) => cardDetailFields(bySlug(slug)).map((f) => f.label);

describe("cardDetailFields", () => {
  it("includes Attack and Health for a Warrior", () => {
    const fields = cardDetailFields(bySlug("hideon"));
    const map = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    expect(map["Faction"]).toBe("Monk");
    expect(map["Type"]).toBe("Warrior");
    expect(map["Attack"]).toBe("2000"); // Package A value
    expect(map["Health"]).toBe("6000");
    expect(map["Cost"]).toBe("1 Spirit");
    expect(map["Rarity"]).toBeDefined();
  });

  it("omits Attack and Health for a non-Warrior (Item)", () => {
    const gils = labels("gils-unit"); // Neutral Item
    expect(gils).not.toContain("Attack");
    expect(gils).not.toContain("Health");
    expect(gils).toContain("Cost");
    expect(gils).toContain("Subtype"); // GILs Unit has a subtype
  });

  it("always leads with Faction and Type and formats Cost in Spirit", () => {
    for (const card of cards) {
      const fields = cardDetailFields(card);
      expect(fields[0]!.label).toBe("Faction");
      expect(fields[1]!.label).toBe("Type");
      const cost = fields.find((f) => f.label === "Cost");
      expect(cost!.value).toMatch(/^\d+ Spirit$/);
    }
  });
});
