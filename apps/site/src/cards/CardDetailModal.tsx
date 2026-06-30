import { useEffect, useRef } from "react";
import { cardImageUrl } from "@euphoria/core/cards";
import type { Card } from "./types";
import { factionTone } from "./factionTone";

const base = import.meta.env.BASE_URL;

interface CardDetailModalProps {
  readonly card: Card;
  readonly onClose: () => void;
}

/** Full card detail overlay. Closes on backdrop click, the × button, or Escape. */
export function CardDetailModal({ card, onClose }: CardDetailModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog and lock background scroll while it's open.
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const hasCombat = card.attack !== undefined || card.health !== undefined;

  return (
    <div
      className="eu-modal"
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      onClick={onClose}
    >
      <div
        className={`eu-modal__card eu-modal__card--${factionTone(card.faction)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="eu-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <div className="eu-modal__art">
          <img src={cardImageUrl(card, base)} alt={card.name} />
        </div>
        <div className="eu-modal__body">
          <h2 className="eu-modal__name">{card.name}</h2>
          <div className="eu-modal__tags">
            <span className={`eu-chip eu-chip--${factionTone(card.faction)}`}>
              {card.faction}
            </span>
            <span className="eu-modal__tag">{card.type}</span>
            <span className="eu-modal__tag">◆ {card.cost} Spirit</span>
            <span className="eu-modal__tag">{card.rarity}</span>
          </div>

          {hasCombat && (
            <div className="eu-modal__stats">
              {card.attack !== undefined && <span>⚔ {card.attack}</span>}
              {card.health !== undefined && <span>♥ {card.health}</span>}
            </div>
          )}

          {card.subtype !== undefined && card.subtype.length > 0 && (
            <p className="eu-modal__subtype">{card.subtype}</p>
          )}

          {card.effectText.length > 0 ? (
            <p className="eu-modal__effect">{card.effectText}</p>
          ) : (
            <p className="eu-modal__effect eu-modal__effect--none">
              No rules text.
            </p>
          )}

          <p className="eu-modal__own" title="Collection tracking coming soon">
            ◇ Ownership tracking — collection sync coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
