import { cards } from "@euphoria/core/cards";

/**
 * The card shape, derived from the shared @euphoria/core data export so the site
 * never re-declares the schema. (Same normalized Card the beta + engine use.)
 */
export type Card = (typeof cards)[number];
