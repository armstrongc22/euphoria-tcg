import {
  factionColor,
  FACTIONS,
  MARKER_TYPES,
  type MapMarker,
} from "./markers";
import {
  collectTags,
  EMPTY_FILTERS,
  SPOILER_ALL,
  type MarkerFilters,
} from "./filters";

interface MapFiltersProps {
  readonly markers: readonly MapMarker[];
  readonly filters: MarkerFilters;
  readonly onChange: (filters: MarkerFilters) => void;
  readonly onClose: () => void;
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * Public filter panel: narrow visible markers by faction, type, tag, and spoiler
 * level. Read-only over the marker data (no editing). Tag options are derived
 * from the live marker set so they always match what's on the map.
 */
export function MapFilters({
  markers,
  filters,
  onChange,
  onClose,
}: MapFiltersProps) {
  const tags = collectTags(markers);

  return (
    <section className="eu-map-filters" aria-label="Map filters">
      <header className="eu-map-filters__head">
        <h3 className="eu-map-filters__title">Filters</h3>
        <div className="eu-map-filters__head-actions">
          <button
            type="button"
            className="eu-map-btn eu-map-btn--sm"
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            Clear
          </button>
          <button
            type="button"
            className="eu-map-btn eu-map-btn--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="eu-map-filters__group">
        <p className="eu-map-filters__label">Faction</p>
        <div className="eu-map-chips">
          {FACTIONS.map((f) => {
            const on = filters.factions.includes(f);
            return (
              <button
                key={f}
                type="button"
                className={`eu-map-chip-btn${on ? " eu-map-chip-btn--on" : ""}`}
                style={{ ["--faction"]: factionColor(f) } as React.CSSProperties}
                aria-pressed={on}
                onClick={() =>
                  onChange({ ...filters, factions: toggle(filters.factions, f) })
                }
              >
                <span className="eu-map-chip-btn__dot" />
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="eu-map-filters__group">
        <p className="eu-map-filters__label">Type</p>
        <div className="eu-map-chips">
          {MARKER_TYPES.map((t) => {
            const on = filters.types.includes(t);
            return (
              <button
                key={t}
                type="button"
                className={`eu-map-chip-btn${on ? " eu-map-chip-btn--on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  onChange({ ...filters, types: toggle(filters.types, t) })
                }
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {tags.length > 0 && (
        <div className="eu-map-filters__group">
          <p className="eu-map-filters__label">Tags</p>
          <div className="eu-map-chips">
            {tags.map((t) => {
              const on = filters.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`eu-map-chip-btn${on ? " eu-map-chip-btn--on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    onChange({ ...filters, tags: toggle(filters.tags, t) })
                  }
                >
                  #{t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="eu-map-filters__group">
        <label className="eu-map-field">
          <span>Max spoiler level</span>
          <select
            value={filters.maxSpoilerLevel}
            onChange={(e) =>
              onChange({ ...filters, maxSpoilerLevel: Number(e.target.value) })
            }
          >
            <option value={SPOILER_ALL}>Show all</option>
            <option value={0}>0 — safe only</option>
            <option value={1}>Up to 1</option>
            <option value={2}>Up to 2</option>
            <option value={3}>Up to 3</option>
          </select>
        </label>
      </div>
    </section>
  );
}
