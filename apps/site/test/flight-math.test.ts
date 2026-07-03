/**
 * 3D Flight Mode math + gating (flight-math.ts): pin placement from the SAME
 * marker data the 2D notation map edits (honoring the schema's 3D authoring
 * fields), flight bounds, the take-off pose, and the WebGL/reduced-motion
 * gate. Pure functions — no three.js, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { MapMarker } from "../src/map/markers";
import {
  DEFAULT_PIN_HEIGHT,
  WORLD_WIDTH,
  clampTarget,
  distanceLimits,
  initialPose,
  pinPlacements,
  shouldFly,
  worldDepthFor,
} from "../src/map/flight-math";

const IMG_W = 1122;
const IMG_H = 1402;

function marker(over: Partial<MapMarker> = {}): MapMarker {
  return {
    id: "m1",
    name: "Musa",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 561, // dead center horizontally
    y: 701, // dead center vertically
    territory: "",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "",
    ...over,
  };
}

describe("worldDepthFor", () => {
  it("preserves the base map's aspect ratio", () => {
    expect(worldDepthFor(IMG_W, IMG_H)).toBeCloseTo((IMG_H / IMG_W) * WORLD_WIDTH, 5);
  });
  it("guards degenerate sizes", () => {
    expect(worldDepthFor(0, 100)).toBe(WORLD_WIDTH);
  });
});

describe("pinPlacements", () => {
  it("maps image pixels onto the centered ground plane", () => {
    const [pin] = pinPlacements([marker()], IMG_W, IMG_H);
    expect(pin!.x).toBeCloseTo(0, 5);
    expect(pin!.z).toBeCloseTo(0, 5);
    // Top-left corner → far-left corner (-x, -z).
    const [corner] = pinPlacements([marker({ x: 0, y: 0 })], IMG_W, IMG_H);
    expect(corner!.x).toBeCloseTo(-WORLD_WIDTH / 2, 5);
    expect(corner!.z).toBeCloseTo(-worldDepthFor(IMG_W, IMG_H) / 2, 5);
  });

  it("honors the schema's 3D authoring fields", () => {
    const [pin] = pinPlacements(
      [
        marker({
          elevation: 0.4,
          markerHeight: 0.9,
          view3d: { scale: 1.5 },
        }),
      ],
      IMG_W,
      IMG_H,
    );
    expect(pin!.baseY).toBe(0.4);
    expect(pin!.height).toBe(0.9);
    expect(pin!.scale).toBe(1.5);
  });

  it("defaults height/scale/elevation and floors tiny scales", () => {
    const [pin] = pinPlacements([marker()], IMG_W, IMG_H);
    expect(pin!.baseY).toBe(0);
    expect(pin!.height).toBe(DEFAULT_PIN_HEIGHT);
    expect(pin!.scale).toBe(1);
    const [tiny] = pinPlacements([marker({ view3d: { scale: 0.01 } })], IMG_W, IMG_H);
    expect(tiny!.scale).toBe(0.2);
  });

  it("skips markers that opted out of 3D and colors by lead faction", () => {
    const pins = pinPlacements(
      [
        marker({ id: "in" }),
        marker({ id: "out", view3d: { enabled: false } }),
        marker({ id: "plain", factionAffinity: [] }),
      ],
      IMG_W,
      IMG_H,
    );
    expect(pins.map((p) => p.marker.id)).toEqual(["in", "plain"]);
    expect(pins[0]!.color).not.toBe(pins[1]!.color); // Dwarf green vs Neutral silver
  });
});

describe("flight bounds + pose", () => {
  const depth = worldDepthFor(IMG_W, IMG_H);

  it("clamps the orbit target onto the map and above the ground", () => {
    const c = clampTarget(99, -5, -99, WORLD_WIDTH, depth);
    expect(c.x).toBeCloseTo(WORLD_WIDTH * 0.48, 5);
    expect(c.y).toBe(0); // never below the deck
    expect(c.z).toBeCloseTo(-depth * 0.48, 5);
    const inside = clampTarget(1, 0.5, -2, WORLD_WIDTH, depth);
    expect(inside).toEqual({ x: 1, y: 0.5, z: -2 });
  });

  it("takes off south of center, looking at the middle of the map", () => {
    const pose = initialPose(depth);
    expect(pose.position.y).toBeGreaterThan(0);
    expect(pose.position.z).toBeGreaterThan(0);
    expect(pose.target).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps the dolly between visiting distance and the horizon", () => {
    const { min, max } = distanceLimits(depth);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
  });
});

describe("shouldFly", () => {
  it("flies only with WebGL and no reduced-motion preference", () => {
    expect(shouldFly(true, false)).toBe(true);
    expect(shouldFly(false, false)).toBe(false);
    expect(shouldFly(true, true)).toBe(false);
    expect(shouldFly(false, true)).toBe(false);
  });
});
