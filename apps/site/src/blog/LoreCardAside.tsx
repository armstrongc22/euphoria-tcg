import type { Card } from "../cards/types";
import { CardTile } from "../cards/CardTile";

interface LoreCardAsideProps {
  readonly card: Card;
  readonly onSelect: (card: Card) => void;
}

/**
 * A magazine-style card callout beside the article text: on wide screens it
 * floats into the right rail next to the section it illustrates, on medium
 * screens the text wraps around it, and on phones it stacks in-flow between
 * paragraphs. Reuses CardTile, so art, fallback, and the detail modal all
 * behave exactly like the Cards page.
 */
export function LoreCardAside({ card, onSelect }: LoreCardAsideProps) {
  return (
    <aside className="eu-post__callout" aria-label={`Card: ${card.name}`}>
      <p className="eu-post__callout-label">Known Figures</p>
      <CardTile card={card} onSelect={onSelect} />
    </aside>
  );
}
