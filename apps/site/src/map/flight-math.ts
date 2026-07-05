/**
 * Pure math + gating for 3D Flight Mode (ux-reboot Phase D). Framework-free —
 * no three.js import — so every placement/bounds/gating rule is unit-testable
 * and the heavy renderer stays behind its dynamic import.
 *
 * The 2D notation map remains the source of truth: markers arrive in image
 * pixels and flow through the shared coords helpers onto a ground plane of
 * WORLD_WIDTH × worldDepthFor(image). The optional per-marker 3D fields
 * (elevation, markerHeight, view3d.{enabled,scale,labelOffsetY}) — already in
 * the schema and editable in notation mode — are the authoring surface.
 */
import { imageToNormalizedCoords, normalizedToThreeCoords } from "./coords";
import { factionColor, type MapMarker } from "./markers";

/** Ground-plane width in world units; depth follows the image aspect. */
export const WORLD_WIDTH = 10;

/** Plane depth preserving the base map's aspect (guarded for bad sizes). */
export function worldDepthFor(imageWidth: number, imageHeight: number): number {
  if (imageWidth <= 0 || imageHeight <= 0) return WORLD_WIDTH;
  return (imageHeight / imageWidth) * WORLD_WIDTH;
}

/** Default pin pole height (world units) when a marker sets none. */
export const DEFAULT_PIN_HEIGHT = 0.32;

/** Everything the renderer needs to place one marker pin. */
export interface PinPlacement {
  readonly marker: MapMarker;
  readonly x: number;
  readonly z: number;
  /** Ground contact of the pole (the marker's elevation, default 0). */
  readonly baseY: number;
  /** Pole height above baseY (markerHeight, default {@link DEFAULT_PIN_HEIGHT}). */
  readonly height: number;
  /** Per-marker scale multiplier (view3d.scale, default 1, floored at 0.2). */
  readonly scale: number;
  /** Faction energy for the head/glow (lead faction; Neutral fallback). */
  readonly color: string;
}

/**
 * Markers → pin placements on the ground plane. Skips markers that opted out
 * of 3D (view3d.enabled === false) — same rule the CSS preview applies.
 */
export function pinPlacements(
  markers: readonly MapMarker[],
  imageWidth: number,
  imageHeight: number,
): PinPlacement[] {
  const depth = worldDepthFor(imageWidth, imageHeight);
  const out: PinPlacement[] = [];
  for (const marker of markers) {
    if (marker.view3d?.enabled === false) continue;
    const { u, v } = imageToNormalizedCoords(marker.x, marker.y, imageWidth, imageHeight);
    const { x, z } = normalizedToThreeCoords(u, v, WORLD_WIDTH, depth);
    out.push({
      marker,
      x,
      z,
      baseY: marker.elevation ?? 0,
      height: marker.markerHeight ?? DEFAULT_PIN_HEIGHT,
      scale: Math.max(0.2, marker.view3d?.scale ?? 1),
      color: factionColor(marker.factionAffinity[0] ?? "Neutral"),
    });
  }
  return out;
}

/**
 * Keeps the camera's orbit target on the map: clamped to the plane's bounds
 * (minus a small margin) and never below the ground.
 */
export function clampTarget(
  x: number,
  y: number,
  z: number,
  worldWidth: number,
  worldDepth: number,
): { x: number; y: number; z: number } {
  const mx = worldWidth * 0.48;
  const mz = worldDepth * 0.48;
  return {
    x: Math.min(mx, Math.max(-mx, x)),
    y: Math.min(worldWidth * 0.5, Math.max(0, y)),
    z: Math.min(mz, Math.max(-mz, z)),
  };
}

/** The take-off pose: south of center, high enough to read the whole map. */
export function initialPose(worldDepth: number): {
  readonly position: { x: number; y: number; z: number };
  readonly target: { x: number; y: number; z: number };
} {
  return {
    position: { x: 0, y: worldDepth * 0.72, z: worldDepth * 0.62 },
    target: { x: 0, y: 0, z: 0 },
  };
}

/** Camera dolly limits: close enough to visit a pin, never past the horizon. */
export function distanceLimits(worldDepth: number): { min: number; max: number } {
  return { min: 1.1, max: worldDepth * 1.5 };
}

/**
 * The flight gate: fly only with WebGL AND no reduced-motion preference —
 * everyone else keeps the calm CSS preview. Pure so the rule is testable; the
 * component feeds it live probes.
 */
export function shouldFly(webglAvailable: boolean, reducedMotion: boolean): boolean {
  return webglAvailable && !reducedMotion;
}

/** Live WebGL probe (same check the CSS preview uses); safe in any runtime. */
export function canUseWebGL(): boolean {
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

/** Live reduced-motion probe; safe in any runtime (jsdom: false). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/* ---- Phase E polish: cinematic, territories, routes, terrain --------------- */

/** Ease-out cubic for the entry flight (pure, clamped). */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/**
 * The entry cinematic's start pose: far higher and further south than the
 * take-off pose, so mounting the mode reads as diving down toward the map.
 * The camera lerps from here to {@link initialPose} over the intro.
 */
export function entryPose(worldDepth: number): { x: number; y: number; z: number } {
  return { x: 0, y: worldDepth * 1.7, z: worldDepth * 1.35 };
}

/** Linear pose interpolation for the entry dive (eased `t` in [0,1]). */
export function lerpPose(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/** One faction territory glow pool under a territory-holding marker. */
export interface TerritoryPool {
  readonly x: number;
  readonly z: number;
  readonly color: string;
  /** Pool radius in world units (grows a little with the marker's scale). */
  readonly radius: number;
}

/**
 * Territory overlays: every 3D-visible marker that names a `territory` AND has
 * a lead faction contributes a soft faction-colored pool on the ground — the
 * "energy on the land" read without inventing borders. Toggleable in the HUD.
 */
export function territoryPools(
  markers: readonly MapMarker[],
  imageWidth: number,
  imageHeight: number,
): TerritoryPool[] {
  const out: TerritoryPool[] = [];
  for (const pin of pinPlacements(markers, imageWidth, imageHeight)) {
    const lead = pin.marker.factionAffinity[0];
    if (pin.marker.territory.trim() === "" || lead === undefined) continue;
    out.push({
      x: pin.x,
      z: pin.z,
      color: factionColor(lead),
      radius: 0.55 * Math.sqrt(pin.scale),
    });
  }
  return out;
}

/** One route trail: ordered ground points + the trail's energy color. */
export interface RouteTrail {
  readonly name: string;
  readonly color: string;
  readonly points: ReadonlyArray<{ x: number; z: number }>;
}

/**
 * Route trails from EXISTING schema, no new fields: markers of type
 * "route point" that share a tag starting with `route:` (e.g. `route:silk`)
 * form one trail, joined in marker-array order (the order notation mode
 * export/import preserves — the authoring convention). Trails need at least
 * two points; the color comes from the first waypoint's lead faction. With no
 * route-point markers in the data (true today) this renders nothing.
 */
export function routeTrails(
  markers: readonly MapMarker[],
  imageWidth: number,
  imageHeight: number,
): RouteTrail[] {
  const groups = new Map<string, Array<{ x: number; z: number; faction: string | undefined }>>();
  for (const pin of pinPlacements(markers, imageWidth, imageHeight)) {
    if (pin.marker.type !== "route point") continue;
    const routeTag = pin.marker.tags.find((t) => t.toLowerCase().startsWith("route:"));
    if (routeTag === undefined) continue;
    const key = routeTag.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push({ x: pin.x, z: pin.z, faction: pin.marker.factionAffinity[0] });
    groups.set(key, list);
  }
  const out: RouteTrail[] = [];
  for (const [name, points] of groups) {
    if (points.length < 2) continue;
    out.push({
      name,
      color: factionColor(points[0]!.faction ?? "Neutral"),
      points: points.map((p) => ({ x: p.x, z: p.z })),
    });
  }
  return out;
}

/**
 * Terrain sampling for the OPTIONAL heightmap (drop a grayscale
 * `public/maps/euphoria-heightmap.png` into the repo — white = high — and the
 * flight scene lifts; absent, the plane stays flat). Pure: reads a decoded
 * RGBA pixel buffer so it's testable without canvas.
 * Returns ground height in world units at normalized (u,v), 0..maxLift.
 */
export function heightAt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
  maxLift: number,
): number {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return 0;
  const px = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
  const py = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
  const value = pixels[(py * width + px) * 4] ?? 0; // red channel of grayscale
  return (value / 255) * maxLift;
}

/** How far the optional heightmap can lift the terrain (world units). */
export const MAX_TERRAIN_LIFT = 0.35;
