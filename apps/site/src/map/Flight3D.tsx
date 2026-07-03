/**
 * The 3D map entry gate (ux-reboot Phase D). Decides ONCE per mount whether
 * this visit gets the real flight scene or the calm CSS preview:
 *
 *   WebGL available AND no reduced-motion preference
 *     → FlightMode3D, lazy-loaded so the three.js chunk is only downloaded
 *       here (2D visitors and fallback devices never pay for it);
 *   otherwise
 *     → the existing MapPreview3D (perspective-tilt CSS, zero dependencies),
 *       exactly as before.
 */
import { lazy, Suspense, useState } from "react";
import type { MapMarker } from "./markers";
import { MapPreview3D } from "./MapPreview3D";
import { canUseWebGL, prefersReducedMotion, shouldFly } from "./flight-math";

const FlightMode3D = lazy(() => import("./FlightMode3D"));

interface Flight3DProps {
  readonly markers: readonly MapMarker[];
  readonly onBack: () => void;
}

export function Flight3D({ markers, onBack }: Flight3DProps) {
  // Probed once per mount; toggling the OS setting mid-visit just means the
  // next visit to the 3D tab re-decides.
  const [fly] = useState(() => shouldFly(canUseWebGL(), prefersReducedMotion()));

  if (!fly) {
    return <MapPreview3D markers={markers} onBack={onBack} />;
  }
  return (
    <Suspense
      fallback={
        <div className="eu-map-3d eu-map-flight">
          <p className="eu-map-flight__status">Preparing flight…</p>
        </div>
      }
    >
      <FlightMode3D markers={markers} onBack={onBack} />
    </Suspense>
  );
}
