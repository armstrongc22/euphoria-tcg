/**
 * Featured-card resolution for the blog's editorial card callouts. Names in
 * posts.ts are looked up against the shared @euphoria/core card list (the
 * same source of truth as the Cards page and the beta) — a name that doesn't
 * exist in the data resolves to nothing rather than a broken tile, and the
 * blog tests fail loudly if a listed name is missing.
 */
import { cards } from "@euphoria/core/cards";
import type { Card } from "../cards/types";
import type { FeaturedCard } from "./posts";

export interface ResolvedFeature {
  readonly card: Card;
  /** Exact h2 text this callout follows; undefined → after the lead paragraph. */
  readonly anchor?: string;
}

/** Exact-name lookup in the shared card data. */
export function findCardByName(name: string): Card | undefined {
  return cards.find((card) => card.name === name);
}

/** Resolves a post's featured list, silently dropping unknown names. */
export function resolveFeaturedCards(
  featured: readonly FeaturedCard[],
): ResolvedFeature[] {
  const out: ResolvedFeature[] = [];
  for (const f of featured) {
    const card = findCardByName(f.name);
    if (card !== undefined) out.push({ card, anchor: f.anchor });
  }
  return out;
}
