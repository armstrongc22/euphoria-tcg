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

/** sessionStorage flag marking that a chunk-recovery reload already happened. */
const RELOAD_FLAG = "eu-flight-chunk-reloaded";

/**
 * Runs a lazy-chunk import with one-shot stale-deploy recovery. Hashed chunk
 * names change on every deploy, and the Worker's SPA fallback answers a
 * missing /assets/* file with 200 index.html — so a tab opened before a
 * redeploy throws "Failed to fetch dynamically imported module" the first
 * time it opens Flight Mode. On failure, reload the page ONCE (fresh HTML →
 * current entry → current chunk); if the import fails again after that
 * reload, something is genuinely broken and the error propagates.
 */
export async function importWithStaleChunkRecovery<T>(
  importer: () => Promise<T>,
  reload: () => void = () => window.location.reload(),
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof sessionStorage ===
  "undefined"
    ? null
    : sessionStorage,
): Promise<T> {
  try {
    const mod = await importer();
    storage?.removeItem(RELOAD_FLAG);
    return mod;
  } catch (err) {
    if (storage !== null && storage.getItem(RELOAD_FLAG) === null) {
      storage.setItem(RELOAD_FLAG, "1");
      reload();
      // The page is reloading; never settle so Suspense keeps its fallback up.
      return new Promise<T>(() => {});
    }
    throw err;
  }
}

const FlightMode3D = lazy(() =>
  importWithStaleChunkRecovery(() => import("./FlightMode3D")),
);

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
