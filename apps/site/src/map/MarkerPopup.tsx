import { useEffect } from "react";
import { factionTone } from "../cards/factionTone";
import type { MapMarker } from "./markers";

interface MarkerPopupProps {
  readonly marker: MapMarker;
  readonly onClose: () => void;
}

/**
 * Read-only lore card shown to normal visitors when they click a map marker.
 * No edit/delete controls — those only exist in debug mode. Reuses the site's
 * `eu-modal` overlay + `eu-chip` faction chips for a consistent franchise look.
 */
export function MarkerPopup({ marker, onClose }: MarkerPopupProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="eu-modal"
      role="dialog"
      aria-modal="true"
      aria-label={marker.name}
      onClick={onClose}
    >
      <div
        className="eu-modal__card eu-map-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="eu-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <p className="eu-map-popup__type">{marker.type}</p>
        <h2 className="eu-modal__name">{marker.name}</h2>

        <div className="eu-modal__tags">
          {marker.territory.length > 0 && (
            <span className="eu-modal__tag">{marker.territory}</span>
          )}
          {marker.factionAffinity.map((f) => (
            <span key={f} className={`eu-chip eu-chip--${factionTone(f)}`}>
              {f}
            </span>
          ))}
        </div>

        {marker.description.length > 0 ? (
          <p className="eu-modal__effect">{marker.description}</p>
        ) : (
          <p className="eu-modal__effect eu-modal__effect--none">
            No lore recorded yet.
          </p>
        )}
      </div>
    </div>
  );
}
