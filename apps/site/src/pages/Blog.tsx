import { PagePlaceholder } from "./PagePlaceholder";

/** Placeholder for updates, lore, and patch notes. */
export function Blog() {
  return (
    <PagePlaceholder eyebrow="Updates & Lore" title="Blog" tone="blue">
      <p>Development updates, lore drops, and patch notes will post here.</p>
      <p className="eu-note">
        Coming soon: a post feed. Source (markdown or CMS) to be decided.
      </p>
    </PagePlaceholder>
  );
}
