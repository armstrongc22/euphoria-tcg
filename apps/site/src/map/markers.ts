/**
 * Pure data layer for the interactive Euphoria map. No React and no direct DOM:
 * marker shape, slug/id generation, validation, JSON import/export, and the
 * localStorage read/write helpers. Kept framework-free so the parsing and
 * validation rules are trivially unit-testable.
 */

/** The five playable factions — reused for marker faction affinity. */
export const FACTIONS = ["Monk", "Dwarf", "Sonic", "Surfer", "Shaman"] as const;

/** All marker categories the editor offers. */
export const MARKER_TYPES = [
  "city",
  "territory",
  "island",
  "ruin",
  "battle site",
  "route point",
  "submerged city",
  "faction zone",
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number];

export interface MapMarker {
  /** Stable slug, auto-derived from the name when absent. */
  readonly id: string;
  readonly name: string;
  readonly type: MarkerType;
  /** Coordinates in the ORIGINAL natural image pixels (resolution-independent). */
  readonly x: number;
  readonly y: number;
  readonly territory: string;
  readonly factionAffinity: readonly string[];
  /** 0 = safe to show everyone; higher = more story-sensitive. */
  readonly spoilerLevel: number;
  readonly description: string;
}

/** localStorage key — bump the suffix if the shape ever changes incompatibly. */
export const STORAGE_KEY = "euphoria_map_markers_v1";

/** Lowercase, hyphenated, alphanumeric slug derived from a free-text name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMarkerType(value: unknown): value is MarkerType {
  return (
    typeof value === "string" &&
    (MARKER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Coerce one untrusted record into a clean MapMarker, or return an error string.
 * Missing optional fields get sane defaults; a missing id is derived from name.
 */
export function normalizeMarker(
  raw: unknown,
  index = 0,
): { ok: true; marker: MapMarker } | { ok: false; error: string } {
  const where = `marker #${index + 1}`;
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: `${where}: not an object` };
  }
  const r = raw as Record<string, unknown>;

  const name = typeof r["name"] === "string" ? r["name"].trim() : "";
  if (name.length === 0) return { ok: false, error: `${where}: missing name` };

  if (!isMarkerType(r["type"])) {
    return { ok: false, error: `${where} (${name}): invalid type "${String(r["type"])}"` };
  }

  const x = Number(r["x"]);
  const y = Number(r["y"]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: `${where} (${name}): x/y must be numbers` };
  }

  const idRaw = typeof r["id"] === "string" ? r["id"].trim() : "";
  const id = idRaw.length > 0 ? idRaw : slugify(name);

  const factionAffinity = Array.isArray(r["factionAffinity"])
    ? r["factionAffinity"].filter((f): f is string => typeof f === "string")
    : [];

  const spoilerLevelNum = Number(r["spoilerLevel"]);

  return {
    ok: true,
    marker: {
      id,
      name,
      type: r["type"],
      x,
      y,
      territory: typeof r["territory"] === "string" ? r["territory"] : "",
      factionAffinity,
      spoilerLevel: Number.isFinite(spoilerLevelNum) ? spoilerLevelNum : 0,
      description: typeof r["description"] === "string" ? r["description"] : "",
    },
  };
}

/** Parse + validate a JSON array of markers (the import path). */
export function parseMarkers(
  json: string,
): { ok: true; markers: MapMarker[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: "Top-level JSON must be an array of markers." };
  }
  const markers: MapMarker[] = [];
  for (let i = 0; i < data.length; i++) {
    const result = normalizeMarker(data[i], i);
    if (!result.ok) return result;
    markers.push(result.marker);
  }
  return { ok: true, markers };
}

/** Pretty-printed JSON for the export box / a future permanent data file. */
export function serializeMarkers(markers: readonly MapMarker[]): string {
  return JSON.stringify(markers, null, 2);
}

/** Insert or replace a marker by id, preserving order for existing ids. */
export function upsertMarker(
  markers: readonly MapMarker[],
  marker: MapMarker,
): MapMarker[] {
  const idx = markers.findIndex((m) => m.id === marker.id);
  if (idx === -1) return [...markers, marker];
  const next = markers.slice();
  next[idx] = marker;
  return next;
}

// ---- Persistence -----------------------------------------------------------

/** Load saved markers, falling back to the starter set when none/invalid. */
export function loadMarkers(): MapMarker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return STARTER_MARKERS.slice();
    const result = parseMarkers(raw);
    return result.ok ? result.markers : STARTER_MARKERS.slice();
  } catch {
    return STARTER_MARKERS.slice();
  }
}

/** Persist the current marker set; silently no-ops if storage is unavailable. */
export function saveMarkers(markers: readonly MapMarker[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeMarkers(markers));
  } catch {
    /* storage full / disabled — keep the in-memory set */
  }
}

// ---- Starter placeholders --------------------------------------------------
// Rough coordinates within the base map's natural 1122 x 1402 px. These are
// deliberately approximate — reposition them in debug mode by dragging.

export const STARTER_MARKERS: readonly MapMarker[] = [
  {
    id: "port-troy",
    name: "Port Troy",
    type: "city",
    x: 300,
    y: 1040,
    territory: "Euphrates Territory",
    factionAffinity: ["Sonic", "Shaman"],
    spoilerLevel: 1,
    description:
      "A major coastal city devastated during the Port Troy dragon event.",
  },
  {
    id: "orange-court",
    name: "Orange Court",
    type: "city",
    x: 560,
    y: 700,
    territory: "Aldebaran Territory",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "tarkana",
    name: "Tarkana",
    type: "city",
    x: 820,
    y: 520,
    territory: "Aldebaran Territory",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "seraphim-falls",
    name: "Seraphim Falls",
    type: "ruin",
    x: 640,
    y: 250,
    territory: "Aldebaran Territory",
    factionAffinity: ["Shaman"],
    spoilerLevel: 1,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "metallstadt",
    name: "Metallstadt",
    type: "city",
    x: 880,
    y: 980,
    territory: "Euphrates Territory",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "musa",
    name: "Musa",
    type: "city",
    x: 420,
    y: 460,
    territory: "Aldebaran Territory",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "alta",
    name: "Alta",
    type: "city",
    x: 760,
    y: 760,
    territory: "Euphrates Territory",
    factionAffinity: ["Surfer"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "marina",
    name: "Marina",
    type: "city",
    x: 240,
    y: 800,
    territory: "Euphrates Territory",
    factionAffinity: ["Surfer", "Sonic"],
    spoilerLevel: 0,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "twilight-islands",
    name: "Twilight Islands",
    type: "island",
    x: 980,
    y: 1240,
    territory: "Euphrates Territory",
    factionAffinity: ["Surfer"],
    spoilerLevel: 1,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "aldebaran-territory",
    name: "Aldebaran Territory",
    type: "faction zone",
    x: 560,
    y: 360,
    territory: "Aldebaran Territory",
    factionAffinity: ["Monk", "Dwarf"],
    spoilerLevel: 0,
    description: "Placeholder region marker — reposition in debug mode.",
  },
  {
    id: "euphrates-territory",
    name: "Euphrates Territory",
    type: "faction zone",
    x: 520,
    y: 1160,
    territory: "Euphrates Territory",
    factionAffinity: ["Sonic", "Surfer"],
    spoilerLevel: 0,
    description: "Placeholder region marker — reposition in debug mode.",
  },
];
