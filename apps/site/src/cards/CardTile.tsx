import { cardImageUrl, cardThumbUrl } from "@euphoria/core/cards";
import type { Card } from "./types";
import { factionTone } from "./factionTone";

const base = import.meta.env.BASE_URL;

interface CardTileProps {
  readonly card: Card;
  readonly onSelect: (card: Card) => void;
}

/** A single clickable card in the grid. Opens the detail modal on click. */
export function CardTile({ card, onSelect }: CardTileProps) {
  return (
    <button
      type="button"
      className={`eu-tile eu-tile--${factionTone(card.faction)}`}
      onClick={() => onSelect(card)}
      aria-label={`${card.name} — ${card.faction} ${card.type}`}
    >
      <div className="eu-tile__art">
        {/* Grid tiles load the ~80KB web-optimized thumb, not the multi-MB
            source PNG; the detail modal keeps the full-size art. */}
        <img
          src={cardThumbUrl(card, base)}
          alt={card.name}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // Thumb missing → fall back to the full art (once).
            const img = e.currentTarget;
            const full = cardImageUrl(card, base);
            if (img.src !== full) img.src = full;
          }}
        />
        {/* Ownership isn't wired into the public site yet (no auth here) — a
            neutral placeholder marks that collection tracking is coming. */}
        <span className="eu-tile__own" title="Collection tracking coming soon">
          ◇
        </span>
      </div>
      <div className="eu-tile__meta">
        <span className="eu-tile__name">{card.name}</span>
        <span className="eu-tile__sub">
          {card.faction} · {card.type} · ◆{card.cost}
        </span>
      </div>
    </button>
  );
}
