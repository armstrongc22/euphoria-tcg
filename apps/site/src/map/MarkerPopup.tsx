import { useEffect } from "react";
import { factionColor, type MapMarker } from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";

interface MarkerPopupProps {
  readonly marker: MapMarker;
  readonly onClose: () => void;
}

/**
 * Read-only lore card shown to normal visitors when they click a map marker.
 * No edit/delete controls — those only exist in notation mode. Reuses the site's
 * `eu-modal` overlay; faction chips use the map's own faction colors and the
 * marker's symbol is shown alongside its name.
 */
export function MarkerPopup({ marker, onClose }: MarkerPopupProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lead = marker.factionAffinity[0];

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
        <h2 className="eu-map-popup__name">
          <span
            className="eu-map-popup__glyph"
            style={
              {
                ...(lead !== undefined
                  ? { ["--faction"]: factionColor(lead) }
                  : {}),
              } as React.CSSProperties
            }
          >
            <MarkerGlyph symbol={marker.markerSymbol} />
          </span>
          {marker.name}
        </h2>

        {marker.tags.length > 0 && (
          <div className="eu-modal__tags eu-map-popup__taglist">
            {marker.tags.map((t) => (
              <span key={t} className="eu-map-tag">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="eu-modal__tags">
          {marker.territory.length > 0 && (
            <span className="eu-modal__tag">{marker.territory}</span>
          )}
          {marker.factionAffinity.map((f) => (
            <span
              key={f}
              className="eu-map-faction-chip"
              style={{ ["--faction"]: factionColor(f) } as React.CSSProperties}
            >
              <span className="eu-map-faction-chip__dot" />
              {f}
            </span>
          ))}
          <span className="eu-modal__tag eu-map-popup__spoiler">
            Spoiler level {marker.spoilerLevel}
          </span>
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
