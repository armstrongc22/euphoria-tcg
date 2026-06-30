/**
 * Coordinate conversions bridging the 2D notation system and a future 3D map.
 *
 * The static map is the source of truth: markers store x/y in the ORIGINAL
 * natural image pixels. These helpers translate between three spaces:
 *
 *   image space      pixels, origin top-left  (what markers persist)
 *   normalized space u,v in [0,1]              (resolution-independent bridge)
 *   three space      x/z on a ground plane     (what a Three.js scene consumes)
 *
 * Pure and framework-free so they're trivially unit-testable and can be shared
 * by both the 2D editor and an eventual 3D renderer without duplication.
 */

export interface NormalizedCoords {
  /** Horizontal fraction, 0 = left edge, 1 = right edge. */
  readonly u: number;
  /** Vertical fraction, 0 = top edge, 1 = bottom edge. */
  readonly v: number;
}

export interface ImageCoords {
  readonly x: number;
  readonly y: number;
}

export interface ThreeGroundCoords {
  /** Three.js X: left → right. */
  readonly x: number;
  /** Three.js Z: image top (far) → image bottom (near). */
  readonly z: number;
}

/** Image pixels → normalized [0,1] (guards against a zero/negative image size). */
export function imageToNormalizedCoords(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
): NormalizedCoords {
  return {
    u: imageWidth > 0 ? x / imageWidth : 0,
    v: imageHeight > 0 ? y / imageHeight : 0,
  };
}

/** Normalized [0,1] → image pixels. Inverse of {@link imageToNormalizedCoords}. */
export function normalizedToImageCoords(
  u: number,
  v: number,
  imageWidth: number,
  imageHeight: number,
): ImageCoords {
  return {
    x: u * imageWidth,
    y: v * imageHeight,
  };
}

/**
 * Normalized [0,1] → a Three.js ground plane centered on the origin, spanning
 * worldWidth (X) by worldDepth (Z). u=0.5,v=0.5 maps to (0,0); the image's top
 * edge (v=0) becomes the far edge (-Z) so the map reads "north is away".
 * Elevation (Y) is intentionally not handled here — that comes from a marker's
 * optional `elevation` field at render time.
 */
export function normalizedToThreeCoords(
  u: number,
  v: number,
  worldWidth: number,
  worldDepth: number,
): ThreeGroundCoords {
  return {
    x: (u - 0.5) * worldWidth,
    z: (v - 0.5) * worldDepth,
  };
}
