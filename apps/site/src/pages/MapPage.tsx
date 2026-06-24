import { PagePlaceholder } from "./PagePlaceholder";

/**
 * Placeholder for the explorable map. A 3D scene (React Three Fiber + Drei) is
 * planned here later — intentionally NOT pulled in yet to keep the shell light
 * and the dependency surface small.
 */
export function MapPage() {
  return (
    <PagePlaceholder eyebrow="Explore" title="Map" tone="white">
      <p>
        An explorable 3D map of the Euphoria worlds is planned for this space.
      </p>
      <p className="eu-note">
        Coming later: an interactive scene (React Three Fiber). For now this is a
        placeholder — no 3D dependencies are loaded.
      </p>
    </PagePlaceholder>
  );
}
