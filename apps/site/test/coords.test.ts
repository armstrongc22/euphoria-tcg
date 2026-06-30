import { describe, expect, it } from "vitest";
import {
  imageToNormalizedCoords,
  normalizedToImageCoords,
  normalizedToThreeCoords,
} from "../src/map/coords";

describe("imageToNormalizedCoords", () => {
  it("maps pixels to [0,1] fractions", () => {
    expect(imageToNormalizedCoords(561, 701, 1122, 1402)).toEqual({
      u: 0.5,
      v: 0.5,
    });
    expect(imageToNormalizedCoords(0, 0, 1122, 1402)).toEqual({ u: 0, v: 0 });
    expect(imageToNormalizedCoords(1122, 1402, 1122, 1402)).toEqual({
      u: 1,
      v: 1,
    });
  });

  it("guards against a zero-sized image instead of dividing by zero", () => {
    expect(imageToNormalizedCoords(10, 10, 0, 0)).toEqual({ u: 0, v: 0 });
  });
});

describe("normalizedToImageCoords", () => {
  it("is the inverse of imageToNormalizedCoords", () => {
    const w = 1122;
    const h = 1402;
    const points: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [300, 1040],
      [1122, 1402],
    ];
    for (const [x, y] of points) {
      const n = imageToNormalizedCoords(x, y, w, h);
      const back = normalizedToImageCoords(n.u, n.v, w, h);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });
});

describe("normalizedToThreeCoords", () => {
  it("centers the plane on the origin", () => {
    expect(normalizedToThreeCoords(0.5, 0.5, 100, 200)).toEqual({ x: 0, z: 0 });
  });

  it("puts the image top edge at -Z (far) and bottom at +Z (near)", () => {
    expect(normalizedToThreeCoords(0, 0, 100, 200)).toEqual({ x: -50, z: -100 });
    expect(normalizedToThreeCoords(1, 1, 100, 200)).toEqual({ x: 50, z: 100 });
  });
});
