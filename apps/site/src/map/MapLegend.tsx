import {
  defaultSymbolForType,
  FACTIONS,
  factionColor,
  MARKER_TYPES,
} from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";

interface MapLegendProps {
  readonly onClose: () => void;
}

/**
 * Public, read-only legend explaining the map's visual language: faction ring
 * colors and the default glyph/symbol for each marker type. Purely informative —
 * no editor controls. Collapsed by default; the toolbar toggles it.
 */
export function MapLegend({ onClose }: MapLegendProps) {
  return (
    <section className="eu-map-legend" aria-label="Map legend">
      <header className="eu-map-legend__head">
        <h3 className="eu-map-legend__title">World Guide</h3>
        <button
          type="button"
          className="eu-map-btn eu-map-btn--sm"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div className="eu-map-legend__grid">
        <div>
          <p className="eu-map-legend__sub">Faction colors</p>
          <ul className="eu-map-legend__list">
            {FACTIONS.map((f) => (
              <li key={f} className="eu-map-legend__item">
                <span
                  className="eu-map-legend__swatch"
                  style={{ background: factionColor(f) }}
                />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eu-map-legend__sub">Marker types &amp; symbols</p>
          <ul className="eu-map-legend__list eu-map-legend__list--types">
            {MARKER_TYPES.map((t) => (
              <li key={t} className="eu-map-legend__item">
                <span className="eu-map-legend__glyph">
                  <MarkerGlyph symbol={defaultSymbolForType(t)} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="eu-map-legend__note">
        A marker's ring shows its faction; its shape shows the kind of place.
      </p>
    </section>
  );
}
