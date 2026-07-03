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
