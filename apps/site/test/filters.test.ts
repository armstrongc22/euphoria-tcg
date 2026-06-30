import { describe, expect, it } from "vitest";
import type { MapMarker } from "../src/map/markers";
import {
  activeFilterCount,
  collectTags,
  EMPTY_FILTERS,
  filterMarkers,
  matchesFilters,
  searchMarkers,
  SPOILER_ALL,
  type MarkerFilters,
} from "../src/map/filters";

function marker(p: Partial<MapMarker> & Pick<MapMarker, "id" | "name">): MapMarker {
  return {
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 0,
    y: 0,
    territory: "",
    factionAffinity: [],
    spoilerLevel: 0,
    description: "",
    ...p,
  };
}

const MARKERS: MapMarker[] = [
  marker({
    id: "port-troy",
    name: "Port Troy",
    type: "city",
    tags: ["port", "battle site"],
    territory: "Euphrates Territory",
    factionAffinity: ["Human"],
    spoilerLevel: 1,
    description: "A coastal trade hub.",
  }),
  marker({
    id: "shivas-marsh",
    name: "Shiva's Marsh",
    type: "criminal location",
    tags: ["smugglers"],
    factionAffinity: ["Criminal"],
    spoilerLevel: 2,
    description: "A black-market harbor.",
  }),
  marker({
    id: "musa",
    name: "Musa",
    type: "temple",
    tags: ["port"],
    factionAffinity: ["Monk", "Human"],
    spoilerLevel: 0,
    description: "An ancient temple.",
  }),
];

const filters = (p: Partial<MarkerFilters>): MarkerFilters => ({
  ...EMPTY_FILTERS,
  ...p,
});

describe("filterMarkers", () => {
  it("returns everything with empty filters", () => {
    expect(filterMarkers(MARKERS, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("filters by faction (any overlap)", () => {
    const out = filterMarkers(MARKERS, filters({ factions: ["Human"] }));
    expect(out.map((m) => m.id)).toEqual(["port-troy", "musa"]);
  });

  it("filters by marker type", () => {
    const out = filterMarkers(MARKERS, filters({ types: ["criminal location"] }));
    expect(out.map((m) => m.id)).toEqual(["shivas-marsh"]);
  });

  it("filters by tag (any overlap)", () => {
    const out = filterMarkers(MARKERS, filters({ tags: ["port"] }));
    expect(out.map((m) => m.id)).toEqual(["port-troy", "musa"]);
  });

  it("filters by spoiler level ceiling", () => {
    const out = filterMarkers(MARKERS, filters({ maxSpoilerLevel: 1 }));
    expect(out.map((m) => m.id)).toEqual(["port-troy", "musa"]);
  });

  it("combines facets with AND", () => {
    const out = filterMarkers(
      MARKERS,
      filters({ factions: ["Human"], tags: ["port"], maxSpoilerLevel: 0 }),
    );
    expect(out.map((m) => m.id)).toEqual(["musa"]);
  });
});

describe("matchesFilters / activeFilterCount", () => {
  it("counts active facets", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount(
        filters({ factions: ["Human", "Monk"], maxSpoilerLevel: 1 }),
      ),
    ).toBe(3);
  });

  it("SPOILER_ALL never hides on spoiler grounds", () => {
    const high = marker({ id: "x", name: "X", spoilerLevel: 99 });
    expect(matchesFilters(high, EMPTY_FILTERS)).toBe(true);
    expect(EMPTY_FILTERS.maxSpoilerLevel).toBe(SPOILER_ALL);
  });
});

describe("collectTags", () => {
  it("returns unique sorted tags", () => {
    expect(collectTags(MARKERS)).toEqual([
      "battle site",
      "port",
      "smugglers",
    ]);
  });
});

describe("searchMarkers", () => {
  it("matches by name", () => {
    expect(searchMarkers(MARKERS, "troy").map((m) => m.id)).toEqual([
      "port-troy",
    ]);
  });

  it("matches by type", () => {
    expect(searchMarkers(MARKERS, "temple").map((m) => m.id)).toEqual(["musa"]);
  });

  it("matches by tag", () => {
    expect(searchMarkers(MARKERS, "smugglers").map((m) => m.id)).toEqual([
      "shivas-marsh",
    ]);
  });

  it("matches by faction affinity", () => {
    expect(searchMarkers(MARKERS, "criminal").map((m) => m.id)).toEqual([
      "shivas-marsh",
    ]);
  });

  it("matches by territory", () => {
    expect(searchMarkers(MARKERS, "euphrates").map((m) => m.id)).toEqual([
      "port-troy",
    ]);
  });

  it("matches by description", () => {
    expect(searchMarkers(MARKERS, "harbor").map((m) => m.id)).toEqual([
      "shivas-marsh",
    ]);
  });

  it("ranks name-prefix matches ahead of other-field matches", () => {
    // "port" is Port Troy's name prefix and also Musa's tag → Port Troy first.
    expect(searchMarkers(MARKERS, "port").map((m) => m.id)).toEqual([
      "port-troy",
      "musa",
    ]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchMarkers(MARKERS, "   ")).toEqual([]);
  });
});
