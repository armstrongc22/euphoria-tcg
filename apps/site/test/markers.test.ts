import { describe, expect, it } from "vitest";
import {
  defaultSymbolForType,
  factionColor,
  FACTIONS,
  MARKER_TYPES,
  normalizeMarker,
  parseMarkers,
  parseTags,
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
      // New fields default gracefully for old-shaped data.
      expect(r.marker.tags).toEqual([]);
      expect(r.marker.markerSymbol).toBe("circle");
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

  it("omits the optional 3D fields when absent (backward compatible)", () => {
    const r = normalizeMarker({ name: "X", type: "city", x: 1, y: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("elevation" in r.marker).toBe(false);
      expect("markerHeight" in r.marker).toBe(false);
      expect("view3d" in r.marker).toBe(false);
    }
  });

  it("preserves valid optional 3D fields", () => {
    const r = normalizeMarker({
      name: "X",
      type: "city",
      x: 1,
      y: 2,
      elevation: 12,
      markerHeight: 4,
      view3d: { enabled: false, scale: 1.5, labelOffsetY: 3 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.elevation).toBe(12);
      expect(r.marker.markerHeight).toBe(4);
      expect(r.marker.view3d).toEqual({
        enabled: false,
        scale: 1.5,
        labelOffsetY: 3,
      });
    }
  });

  it("drops bogus 3D field values rather than storing them", () => {
    const r = normalizeMarker({
      name: "X",
      type: "city",
      x: 1,
      y: 2,
      elevation: "high",
      view3d: { enabled: "yes", scale: "big" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("elevation" in r.marker).toBe(false);
      expect("view3d" in r.marker).toBe(false);
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

describe("expanded types, factions, and colors", () => {
  it("offers the new marker types", () => {
    for (const t of [
      "historic site",
      "criminal location",
      "business",
      "temple",
    ]) {
      expect((MARKER_TYPES as readonly string[]).includes(t)).toBe(true);
    }
  });

  it("offers the Human, Neutral, and Criminal factions", () => {
    expect((FACTIONS as readonly string[]).includes("Human")).toBe(true);
    expect((FACTIONS as readonly string[]).includes("Neutral")).toBe(true);
    expect((FACTIONS as readonly string[]).includes("Criminal")).toBe(true);
  });

  it("maps each faction to its map color", () => {
    expect(factionColor("Dwarf")).toBe("#29d17a");
    expect(factionColor("Monk")).toBe("#ff2e4d");
    expect(factionColor("Surfer")).toBe("#2e8bff");
    expect(factionColor("Sonic")).toBe("#f2c11d");
    expect(factionColor("Shaman")).toBe("#9b5cff");
    expect(factionColor("Human")).toBe("#a9744f");
    expect(factionColor("Neutral")).toBe("#c3c8d2");
    expect(factionColor("Criminal")).toBe("#000000");
  });

  it("falls back to silver for an unknown faction", () => {
    expect(factionColor("Aliens")).toBe("#c3c8d2");
  });

  it("accepts the new types/factions through normalizeMarker", () => {
    const r = normalizeMarker({
      name: "Tarkana Temple",
      type: "temple",
      x: 1,
      y: 2,
      factionAffinity: ["Human", "Neutral", "Criminal"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.type).toBe("temple");
      expect(r.marker.factionAffinity).toEqual(["Human", "Neutral", "Criminal"]);
    }
  });

  it("round-trips a Criminal-faction marker through import/export", () => {
    const marker: MapMarker = {
      id: "smugglers-den",
      name: "Smugglers' Den",
      type: "criminal location",
      tags: ["criminal location"],
      markerSymbol: "skull",
      x: 410,
      y: 905,
      territory: "Euphrates Territory",
      factionAffinity: ["Criminal"],
      spoilerLevel: 2,
      description: "A black-market harbor.",
    };
    const r = parseMarkers(serializeMarkers([marker]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markers[0]).toEqual(marker);
  });
});

describe("parseTags", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseTags(" historic site ,  temple , ,battle site")).toEqual([
      "historic site",
      "temple",
      "battle site",
    ]);
  });

  it("de-duplicates case-insensitively, keeping first spelling", () => {
    expect(parseTags("Temple, temple, TEMPLE")).toEqual(["Temple"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseTags("   ,  , ")).toEqual([]);
  });
});

describe("tags + markerSymbol in normalizeMarker", () => {
  it("defaults markerSymbol to circle and tags to [] when absent", () => {
    const r = normalizeMarker({ name: "X", type: "temple", x: 1, y: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.markerSymbol).toBe("circle");
      expect(r.marker.tags).toEqual([]);
    }
  });

  it("preserves a valid markerSymbol and a string[] of tags", () => {
    const r = normalizeMarker({
      name: "X",
      type: "criminal location",
      markerSymbol: "skull",
      tags: [" smugglers ", "criminal location", "smugglers"],
      x: 1,
      y: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.markerSymbol).toBe("skull");
      expect(r.marker.tags).toEqual(["smugglers", "criminal location"]);
    }
  });

  it("falls back to circle for an unknown markerSymbol", () => {
    const r = normalizeMarker({
      name: "X",
      type: "city",
      markerSymbol: "rocket",
      x: 1,
      y: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marker.markerSymbol).toBe("circle");
  });

  it("accepts a comma-separated tags string too", () => {
    const r = normalizeMarker({
      name: "X",
      type: "city",
      tags: "business, historic site",
      x: 1,
      y: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marker.tags).toEqual(["business", "historic site"]);
  });
});

describe("defaultSymbolForType", () => {
  it("suggests the mapped symbol per type", () => {
    expect(defaultSymbolForType("temple")).toBe("temple");
    expect(defaultSymbolForType("criminal location")).toBe("skull");
    expect(defaultSymbolForType("business")).toBe("coin");
    expect(defaultSymbolForType("historic site")).toBe("scroll");
    expect(defaultSymbolForType("city")).toBe("circle");
  });
});

describe("backward compatibility", () => {
  it("validates an old marker with no tags/symbol/new factions", () => {
    const legacy = JSON.stringify([
      {
        id: "old-town",
        name: "Old Town",
        type: "city",
        x: 100,
        y: 200,
        territory: "Euphrates Territory",
        factionAffinity: ["Sonic"],
        spoilerLevel: 0,
        description: "Pre-upgrade marker.",
      },
    ]);
    const r = parseMarkers(legacy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markers[0]?.tags).toEqual([]);
      expect(r.markers[0]?.markerSymbol).toBe("circle");
    }
  });

  it("round-trips a marker carrying every new field", () => {
    const full: MapMarker = {
      id: "port-troy",
      name: "Port Troy",
      type: "city",
      tags: ["historic site", "battle site"],
      markerSymbol: "circle",
      x: 1840,
      y: 2920,
      territory: "Euphrates Territory",
      factionAffinity: ["Sonic", "Human"],
      spoilerLevel: 1,
      description: "A major coastal city.",
      elevation: 12,
      markerHeight: 36,
      view3d: { enabled: true, scale: 1, labelOffsetY: 40 },
    };
    const r = parseMarkers(serializeMarkers([full]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markers[0]).toEqual(full);
  });
});

describe("optional lore fields", () => {
  it("omits related-lore fields when absent", () => {
    const r = normalizeMarker({ name: "X", type: "city", x: 1, y: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("relatedCharacters" in r.marker).toBe(false);
      expect("relatedArcs" in r.marker).toBe(false);
      expect("relatedCards" in r.marker).toBe(false);
      expect("relatedLinks" in r.marker).toBe(false);
    }
  });

  it("keeps valid related-lore fields and trims string lists", () => {
    const r = normalizeMarker({
      name: "Port Troy",
      type: "city",
      x: 1,
      y: 2,
      relatedCharacters: [" Kai ", "", "Delta"],
      relatedArcs: ["Port Troy Dragon Event"],
      relatedCards: ["Mark Lee Fathom"],
      relatedLinks: [
        { label: "Wiki", url: "https://example.com/port-troy" },
        { label: "", url: "https://bad" },
        { nope: true },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.marker.relatedCharacters).toEqual(["Kai", "Delta"]);
      expect(r.marker.relatedArcs).toEqual(["Port Troy Dragon Event"]);
      expect(r.marker.relatedCards).toEqual(["Mark Lee Fathom"]);
      expect(r.marker.relatedLinks).toEqual([
        { label: "Wiki", url: "https://example.com/port-troy" },
      ]);
    }
  });

  it("round-trips related-lore fields through import/export", () => {
    const full: MapMarker = {
      id: "port-troy",
      name: "Port Troy",
      type: "city",
      tags: [],
      markerSymbol: "circle",
      x: 10,
      y: 20,
      territory: "",
      factionAffinity: ["Human"],
      spoilerLevel: 0,
      description: "Hub.",
      relatedCharacters: ["Kai"],
      relatedArcs: ["Dragon Event"],
      relatedCards: ["Mark Lee Fathom"],
      relatedLinks: [{ label: "Wiki", url: "https://example.com" }],
    };
    const r = parseMarkers(serializeMarkers([full]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markers[0]).toEqual(full);
  });

  it("drops a related-lore field that is entirely invalid", () => {
    const r = normalizeMarker({
      name: "X",
      type: "city",
      x: 1,
      y: 2,
      relatedCharacters: [1, 2, 3],
      relatedLinks: "nope",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("relatedCharacters" in r.marker).toBe(false);
      expect("relatedLinks" in r.marker).toBe(false);
    }
  });
});

describe("upsertMarker", () => {
  const base: MapMarker = {
    id: "a",
    name: "A",
    type: "city",
    tags: [],
    markerSymbol: "circle",
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
