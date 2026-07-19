import { InteractiveMap } from "../map/InteractiveMap";
import { usePageTitle } from "../usePageTitle";

/**
 * The Euphoria world map section. Shows the base map with lore markers for every
 * visitor; the hidden notation/editor tools appear only when the URL carries
 * ?mapDebug=1 (see InteractiveMap). A 3D scene may still replace this later, but
 * the 2D annotated map is the live experience for now — no heavy 3D deps loaded.
 */
export function MapPage() {
  usePageTitle("World Map");
  return (
    <div className="eu-page eu-page--purple">
      <p className="eu-page__eyebrow">Explore</p>
      <h1 className="eu-page__title">World Map</h1>
      <div className="eu-page__body">
        <p>
          Chart the cities, territories, and drowned ruins of the Euphoria
          worlds. Click a marker to read its lore; scroll or use the controls to
          zoom and pan.
        </p>
      </div>
      <InteractiveMap />
    </div>
  );
}
