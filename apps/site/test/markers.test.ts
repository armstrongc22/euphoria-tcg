import { describe, expect, it } from "vitest";
import {
  normalizeMarker,
  parseMarkers,
  serializeMarkers,
  slugify,
  STARTER_MARKERS,
  upsertMarker,
  type MapMarker,
} from "../src/map/markers";

describe("slugify", () => {
  it("lowercases, hyphenates, and trims", () => {
    expect(slugify("Port Troy")).toBe("port-troy");
    expect(slugify("  Twilight   Islands! ")).toBe("twilight-islands");
    expect(slugify("Seraphim Falls (north)")).toBe("seraphim-falls-north");
  });
});

describe("normalizeMarker", () => {
  it("derives an id from the name when none is given", () => {
    const r = normalizeMarker({ name: "Port Troy", type: "city", x: 10, y: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.id).toBe("port-troy");
      expect(r.marker.factionAffinity).toEqual([]);
      expect(r.marker.spoilerLevel).toBe(0);
    }
  });

  it("rejects a missing name", () => {
    const r = normalizeMarker({ type: "city", x: 1, y: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown type", () => {
    const r = normalizeMarker({ name: "X", type: "moon-base", x: 1, y: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric coordinates", () => {
    const r = normalizeMarker({ name: "X", type: "city", x: "nope", y: 2 });
    expect(r.ok).toBe(false);
  });

  it("keeps a supplied id and coerces string numbers", () => {
    const r = normalizeMarker({
      id: "custom",
      name: "X",
      type: "ruin",
      x: "100",
      y: "200",
      spoilerLevel: "2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.id).toBe("custom");
      expect(r.marker.x).toBe(100);
      expect(r.marker.spoilerLevel).toBe(2);
    }
  });
});

describe("parseMarkers", () => {
  it("round-trips the starter set", () => {
    const json = serializeMarkers(STARTER_MARKERS);
    const r = parseMarkers(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markers).toEqual(STARTER_MARKERS);
  });

  it("rejects non-array JSON", () => {
    const r = parseMarkers('{"name":"X"}');
    expect(r.ok).toBe(false);
  });

  it("rejects malformed JSON", () => {
    const r = parseMarkers("not json");
    expect(r.ok).toBe(false);
  });

  it("fails the whole import if any marker is invalid", () => {
    const r = parseMarkers(
      JSON.stringify([
        { name: "Good", type: "city", x: 1, y: 2 },
        { name: "Bad", type: "???", x: 1, y: 2 },
      ]),
    );
    expect(r.ok).toBe(false);
  });
});

describe("upsertMarker", () => {
  const base: MapMarker = {
    id: "a",
    name: "A",
    type: "city",
    x: 1,
    y: 1,
    territory: "",
    factionAffinity: [],
    spoilerLevel: 0,
    description: "",
  };

  it("appends a new marker", () => {
    const next = upsertMarker([base], { ...base, id: "b", name: "B" });
    expect(next.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("replaces in place, preserving order", () => {
    const list = [base, { ...base, id: "b", name: "B" }];
    const next = upsertMarker(list, { ...base, name: "A2" });
    expect(next.map((m) => m.name)).toEqual(["A2", "B"]);
  });
});
