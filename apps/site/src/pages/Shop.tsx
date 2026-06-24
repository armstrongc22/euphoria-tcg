import { PagePlaceholder } from "./PagePlaceholder";

/** Placeholder for the merch / store. */
export function Shop() {
  return (
    <PagePlaceholder eyebrow="Store" title="Shop" tone="green">
      <p>Merch, prints, and gear from across the Euphoria Universe.</p>
      <p className="eu-note">
        Coming soon: storefront and catalog. Commerce integration to be decided.
      </p>
    </PagePlaceholder>
  );
}
