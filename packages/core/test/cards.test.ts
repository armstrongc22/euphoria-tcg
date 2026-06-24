/**
 * Card data module tests: the browser bundle loads and validates the same
 * cards as the Node loader, and image URLs resolve under any base path.
 */
import { describe, expect, it } from "vitest";
import { cards, cardImageUrl } from "../src/cards";

describe("browser card data", () => {
  it("loads and validates the full card set", () => {
    expect(cards.length).toBeGreaterThan(100);
    expect(
      cards.every((c) => c.name.length > 0 && c.imageFile.endsWith(".png")),
    ).toBe(true);
  });

  it("exposes the normalized fields (cost, effectText)", () => {
    const card = cards.find((c) => c.slug === "hideon");
    expect(card).toBeDefined();
    expect(card!.cost).toBe(card!.spiritCost);
    expect(typeof card!.effectText).toBe("string");
  });
});

describe("cardImageUrl", () => {
  it("joins the base path with the card's imageFile", () => {
    const card = cards.find((c) => c.slug === "hideon")!;
    expect(card.imageFile).toBe("monk/hideon.png");
    expect(cardImageUrl(card, "/")).toBe("/monk/hideon.png");
    expect(cardImageUrl(card, "/euphoria/")).toBe("/euphoria/monk/hideon.png");
  });
});
