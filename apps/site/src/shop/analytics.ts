/**
 * Analytics-ready shop events. No tracker is bundled — events are emitted to
 * two integration points any future analytics can attach to without a deploy:
 *
 *  1. `window.dataLayer.push({ event, ...data })` — the GTM/GA convention;
 *     created if absent, so a later tag manager picks up history from load.
 *  2. a DOM CustomEvent `euphoria:shop` on `window` — for custom listeners.
 *
 * Emission is best-effort and must never break shopping.
 */

export type ShopEventName =
  | "shop_view"
  | "shop_collection_click"
  | "shop_product_click"
  | "shop_buy_click";

export interface ShopEventData {
  readonly collection?: string;
  readonly product?: string;
  readonly url?: string;
}

export function trackShop(event: ShopEventName, data: ShopEventData = {}): void {
  try {
    const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
    (w.dataLayer ??= []).push({ event, ...data });
  } catch {
    /* best-effort */
  }
  try {
    window.dispatchEvent(new CustomEvent("euphoria:shop", { detail: { event, ...data } }));
  } catch {
    /* best-effort */
  }
}
