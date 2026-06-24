import { PagePlaceholder } from "./PagePlaceholder";

/** Placeholder for the manga reader / chapter index. */
export function Manga() {
  return (
    <PagePlaceholder eyebrow="The Saga" title="Manga" tone="purple">
      <p>
        The Euphoria manga lives here — chapters, lore, and the story behind the
        five factions.
      </p>
      <p className="eu-note">
        Coming soon: a chapter index and reader. Content pipeline to be wired up.
      </p>
    </PagePlaceholder>
  );
}
