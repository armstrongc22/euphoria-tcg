import { useState } from "react";
import { factionColor, type MapMarker } from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";
import { searchMarkers } from "./filters";

interface MapSearchProps {
  readonly markers: readonly MapMarker[];
  /** Called when a result is chosen — focus/center/open in the parent. */
  readonly onPick: (id: string) => void;
}

const MAX_RESULTS = 8;

/**
 * Public map search. Matches name, type, tags, territory, faction, and
 * description (via the pure `searchMarkers`), showing a ranked dropdown. Picking
 * a result hands the id back to the map to focus/center/open it.
 */
export function MapSearch({ markers, onPick }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = open ? searchMarkers(markers, query).slice(0, MAX_RESULTS) : [];

  function choose(id: string): void {
    onPick(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="eu-map-search">
      <span className="eu-map-search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        type="search"
        className="eu-map-search__input"
        placeholder="Search places, factions, tags…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a result's click registers before the list unmounts.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0] !== undefined) {
            e.preventDefault();
            choose(results[0].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-label="Search the map"
      />
      {query.length > 0 && open && (
        <ul className="eu-map-search__results">
          {results.length === 0 && (
            <li className="eu-map-search__empty">No matches.</li>
          )}
          {results.map((m) => {
            const lead = m.factionAffinity[0];
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="eu-map-search__result"
                  // onMouseDown fires before input blur, so the pick isn't lost.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(m.id);
                  }}
                >
                  <span
                    className="eu-map-search__glyph"
                    style={
                      {
                        ...(lead !== undefined
                          ? { ["--faction"]: factionColor(lead) }
                          : {}),
                      } as React.CSSProperties
                    }
                  >
                    <MarkerGlyph symbol={m.markerSymbol} />
                  </span>
                  <span className="eu-map-search__text">
                    <span className="eu-map-search__name">{m.name}</span>
                    <span className="eu-map-search__meta">
                      {m.type}
                      {m.factionAffinity.length > 0 &&
                        ` · ${m.factionAffinity.join("/")}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
