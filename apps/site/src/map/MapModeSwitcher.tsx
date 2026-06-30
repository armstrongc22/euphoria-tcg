export type MapMode = "2d" | "3d";

interface MapModeSwitcherProps {
  readonly mode: MapMode;
  readonly onChange: (mode: MapMode) => void;
}

/**
 * Public segmented control for choosing the map view. Visible to everyone (it's
 * not part of notation mode); the editor stays bound to the 2D static map, while
 * "3D Preview" is an experimental read-only view of the same marker data.
 */
export function MapModeSwitcher({ mode, onChange }: MapModeSwitcherProps) {
  return (
    <div className="eu-map-modes" role="tablist" aria-label="Map view">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "2d"}
        className={`eu-map-mode${mode === "2d" ? " eu-map-mode--active" : ""}`}
        onClick={() => onChange("2d")}
      >
        2D Map
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "3d"}
        className={`eu-map-mode${mode === "3d" ? " eu-map-mode--active" : ""}`}
        onClick={() => onChange("3d")}
      >
        3D Preview
        <span className="eu-map-mode__tag">beta</span>
      </button>
    </div>
  );
}
