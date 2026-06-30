import { useEffect, useState } from "react";
import { imageToNormalizedCoords } from "./coords";
import type { MapMarker } from "./markers";

const MAP_SRC = `${import.meta.env.BASE_URL}maps/euphoria-base-map.png`;

interface MapPreview3DProps {
  /** The same marker set the 2D notation system edits — read-only here. */
  readonly markers: readonly MapMarker[];
  readonly onBack: () => void;
}

/** Minimal WebGL capability probe; gates the experimental preview vs. fallback. */
function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return (
      typeof WebGLRenderingContext !== "undefined" &&
      (canvas.getContext("webgl") !== null ||
        canvas.getContext("experimental-webgl") !== null)
    );
  } catch {
    return false;
  }
}

/**
 * Experimental 3D preview. Deliberately NOT a real Three.js scene yet — it's a
 * read-only, perspective-tilted projection of the live marker data so the
 * pipeline (same markers → normalized coords → world plane) is visible and the
 * future renderer has a clear seam to slot into. When WebGL isn't available we
 * show a graceful fallback instead.
 *
 * Future Three.js integration path (no dependency added yet):
 *   1. `npm i three @react-three/fiber @react-three/drei` (in @euphoria/site).
 *   2. Replace `.eu-map-3d__plane` with a <Canvas>; drop the base map onto a
 *      PlaneGeometry sized worldWidth × worldDepth.
 *   3. For each marker: `imageToNormalizedCoords` → `normalizedToThreeCoords`
 *      for X/Z, raise by `elevation`, size by `view3d.scale`, offset the label
 *      by `view3d.labelOffsetY`, and skip when `view3d.enabled === false`.
 */
export function MapPreview3D({ markers, onBack }: MapPreview3DProps) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setReady(detectWebGL());
    // Load the base map once just to learn its natural size for normalization.
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = MAP_SRC;
  }, []);

  // Markers can opt out of the 3D view via view3d.enabled === false.
  const visible = markers.filter((m) => m.view3d?.enabled !== false);

  return (
    <div className="eu-map-3d">
      <div className="eu-map-3d__bar">
        <p className="eu-map-3d__title">
          3D Preview <span className="eu-map-3d__tag">experimental</span>
        </p>
        <button type="button" className="eu-map-btn" onClick={onBack}>
          ← Back to 2D Map
        </button>
      </div>

      {ready === false ? (
        <div className="eu-map-3d__fallback">
          <p className="eu-map-3d__fallback-title">3D view not available</p>
          <p>
            This device or browser can't run the 3D preview yet (WebGL is
            unavailable). The full map experience lives in the 2D view — every
            location and all lore are there.
          </p>
          <button type="button" className="eu-map-btn eu-map-btn--primary" onClick={onBack}>
            Back to 2D Map
          </button>
        </div>
      ) : (
        <div className="eu-map-3d__stage">
          <div className="eu-map-3d__scene">
            <div
              className="eu-map-3d__plane"
              style={{ backgroundImage: `url(${MAP_SRC})` }}
            >
              {dims !== null &&
                visible.map((m) => {
                  const { u, v } = imageToNormalizedCoords(m.x, m.y, dims.w, dims.h);
                  return (
                    <span
                      key={m.id}
                      className="eu-map-3d__pin"
                      data-type={m.type}
                      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                      title={m.name}
                    />
                  );
                })}
            </div>
          </div>
          <p className="eu-map-3d__note">
            Experimental projection of {visible.length} marker
            {visible.length === 1 ? "" : "s"} from the live notation data. A full
            interactive Three.js scene is planned here — markers, elevation, and
            labels will read from the same source of truth. Use{" "}
            <strong>2D Map</strong> above to place or edit locations.
          </p>
        </div>
      )}
    </div>
  );
}
