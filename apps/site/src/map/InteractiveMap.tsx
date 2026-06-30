import { useEffect, useState } from "react";
import { loadMarkers, saveMarkers, type MapMarker } from "./markers";
import { MapModeSwitcher, type MapMode } from "./MapModeSwitcher";
import { StaticMap2D } from "./StaticMap2D";
import { MapPreview3D } from "./MapPreview3D";
import "./map.css";

/**
 * Container for the Euphoria map experience. Owns the shared marker set (the
 * single source of truth, persisted to localStorage) and the public 2D/3D view
 * switch, then delegates rendering:
 *
 *   2D Map      → {@link StaticMap2D}: the responsive static map AND the hidden
 *                 notation editor (compass 5-tap unlock). This is where markers
 *                 are placed/edited — the source of truth.
 *   3D Preview  → {@link MapPreview3D}: an experimental, read-only projection of
 *                 the same markers, with a graceful fallback when WebGL is
 *                 unavailable. No 3D dependency is loaded yet.
 *
 * The notation editor stays bound to the 2D map; switching to 3D never exposes
 * editing controls, and the switcher (plus the preview's "Back to 2D Map"
 * button) guarantees you can always return to the static map.
 */
export function InteractiveMap() {
  const [markers, setMarkers] = useState<MapMarker[]>(() => loadMarkers());
  const [mode, setMode] = useState<MapMode>("2d");

  // Persist on every change — the set is tiny so this is cheap. Lives here so
  // both views share one source of truth regardless of which is mounted.
  useEffect(() => {
    saveMarkers(markers);
  }, [markers]);

  return (
    <div className="eu-map-root">
      <MapModeSwitcher mode={mode} onChange={setMode} />
      {mode === "2d" ? (
        <StaticMap2D markers={markers} onMarkersChange={setMarkers} />
      ) : (
        <MapPreview3D markers={markers} onBack={() => setMode("2d")} />
      )}
    </div>
  );
}
