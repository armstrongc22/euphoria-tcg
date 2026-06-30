/**
 * Pure data layer for the interactive Euphoria map. No React and no direct DOM:
 * marker shape, slug/id generation, validation, JSON import/export, and the
 * localStorage read/write helpers. Kept framework-free so the parsing and
 * validation rules are trivially unit-testable.
 */

/** Factions a marker can be affiliated with (multi-select). */
export const FACTIONS = [
  "Monk",
  "Dwarf",
  "Sonic",
  "Surfer",
  "Shaman",
  "Human",
  "Neutral",
  "Criminal",
] as const;

/**
 * Map-only faction → color. Deliberately separate from the site-wide
 * `factionTone` (used by the card UI) because the map uses its own palette
 * (e.g. Sonic = yellow here, blue there). Unknown factions fall back to silver.
 */
export const FACTION_COLORS: Record<string, string> = {
  Dwarf: "#29d17a", // green
  Monk: "#ff2e4d", // red
  Surfer: "#2e8bff", // blue
  Sonic: "#f2c11d", // yellow
  Shaman: "#9b5cff", // purple
  Human: "#a9744f", // brown
  Neutral: "#c3c8d2", // silver
  Criminal: "#000000", // black
};

/** Hex color for a faction (silver fallback for anything unrecognised). */
export function factionColor(faction: string): string {
  return FACTION_COLORS[faction] ?? FACTION_COLORS["Neutral"]!;
}

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
  "historic site",
  "criminal location",
  "business",
  "temple",
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number];

/** Symbol/shape glyphs a marker can render with (independent of faction color). */
export const MARKER_SYMBOLS = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "cross",
  "tower",
  "temple",
  "skull",
  "coin",
  "scroll",
  "flag",
] as const;

export type MarkerSymbol = (typeof MARKER_SYMBOLS)[number];

/** Safe fallback when a marker has no symbol set. */
export const DEFAULT_SYMBOL: MarkerSymbol = "circle";

/**
 * Suggested symbol for a given type — used by the form to pre-fill the selector
 * for a NEW marker. Not applied at the data layer: imported markers with no
 * symbol default to {@link DEFAULT_SYMBOL} so old data behaves predictably.
 */
export const DEFAULT_SYMBOL_BY_TYPE: Record<MarkerType, MarkerSymbol> = {
  city: "circle",
  territory: "hexagon",
  island: "diamond",
  ruin: "tower",
  "battle site": "cross",
  "route point": "flag",
  "submerged city": "diamond",
  "faction zone": "pentagon",
  "historic site": "scroll",
  "criminal location": "skull",
  business: "coin",
  temple: "temple",
};

/** Default symbol the form offers when creating a marker of `type`. */
export function defaultSymbolForType(type: MarkerType): MarkerSymbol {
  return DEFAULT_SYMBOL_BY_TYPE[type] ?? DEFAULT_SYMBOL;
}

/**
 * Parse a comma-separated tag string into a clean list: trimmed, empties
 * dropped, duplicates removed (case-insensitive, first spelling wins).
 */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const tag = part.trim();
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * Optional per-marker hints for the future 3D map. All fields are optional so
 * existing 2D-only marker data keeps validating unchanged; the 3D renderer
 * supplies its own defaults when they're missing.
 */
export interface MarkerView3D {
  /** Whether this marker should be shown in the 3D view (defaults to true). */
  readonly enabled?: boolean;
  /** Per-marker scale multiplier for the 3D billboard/model. */
  readonly scale?: number;
  /** Vertical nudge (world units) for the 3D label so it clears terrain. */
  readonly labelOffsetY?: number;
}

export interface MapMarker {
  /** Stable slug, auto-derived from the name when absent. */
  readonly id: string;
  readonly name: string;
  readonly type: MarkerType;
  /** Free-form custom tags/categories, separate from `type` (may be empty). */
  readonly tags: readonly string[];
  /** Shape glyph; defaults to {@link DEFAULT_SYMBOL} for old data. */
  readonly markerSymbol: MarkerSymbol;
  /** Coordinates in the ORIGINAL natural image pixels (resolution-independent). */
  readonly x: number;
  readonly y: number;
  readonly territory: string;
  readonly factionAffinity: readonly string[];
  /** 0 = safe to show everyone; higher = more story-sensitive. */
  readonly spoilerLevel: number;
  readonly description: string;

  // ---- Optional future-3D fields (ignored by the 2D view) ----
  /** Ground elevation in world units, for raising the marker in 3D. */
  readonly elevation?: number;
  /** Height of the marker's pole/billboard in world units. */
  readonly markerHeight?: number;
  /** 3D-specific rendering hints. */
  readonly view3d?: MarkerView3D;
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

function isMarkerSymbol(value: unknown): value is MarkerSymbol {
  return (
    typeof value === "string" &&
    (MARKER_SYMBOLS as readonly string[]).includes(value)
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

  // Tags accept a string[] (canonical) or a comma-separated string (lenient),
  // each normalized to trimmed, de-duplicated entries. Missing → [].
  const tags = Array.isArray(r["tags"])
    ? parseTags(
        r["tags"].filter((t): t is string => typeof t === "string").join(","),
      )
    : typeof r["tags"] === "string"
      ? parseTags(r["tags"])
      : [];

  // Unknown/missing symbols fall back to the safe default so old data renders.
  const markerSymbol = isMarkerSymbol(r["markerSymbol"])
    ? r["markerSymbol"]
    : DEFAULT_SYMBOL;

  const spoilerLevelNum = Number(r["spoilerLevel"]);

  return {
    ok: true,
    marker: {
      id,
      name,
      type: r["type"],
      tags,
      markerSymbol,
      x,
      y,
      territory: typeof r["territory"] === "string" ? r["territory"] : "",
      factionAffinity,
      spoilerLevel: Number.isFinite(spoilerLevelNum) ? spoilerLevelNum : 0,
      description: typeof r["description"] === "string" ? r["description"] : "",
      // Optional 3D fields are only attached when present & valid, so 2D-only
      // markers round-trip byte-for-byte and nothing leaks bogus defaults.
      ...optionalNumber(r["elevation"], "elevation"),
      ...optionalNumber(r["markerHeight"], "markerHeight"),
      ...normalizeView3D(r["view3d"]),
    },
  };
}

/** `{ [key]: n }` when value is a finite number, else `{}` (field omitted). */
function optionalNumber(value: unknown, key: string): Record<string, number> {
  return typeof value === "number" && Number.isFinite(value)
    ? { [key]: value }
    : {};
}

/** Pull through only the recognised, well-typed view3d hints; omit if empty. */
function normalizeView3D(value: unknown): { view3d?: MarkerView3D } {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const view3d: MarkerView3D = {
    ...(typeof v["enabled"] === "boolean" ? { enabled: v["enabled"] } : {}),
    ...optionalNumber(v["scale"], "scale"),
    ...optionalNumber(v["labelOffsetY"], "labelOffsetY"),
  };
  return Object.keys(view3d).length > 0 ? { view3d } : {};
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
    tags: ["historic site", "battle site"],
    markerSymbol: "circle",
    x: 300,
    y: 1040,
    territory: "Euphrates Territory",
    factionAffinity: ["Sonic", "Human"],
    spoilerLevel: 1,
    description:
      "A major coastal city devastated during the Port Troy dragon event.",
  },
  {
    id: "orange-court",
    name: "Orange Court",
    type: "city",
    tags: ["business"],
    markerSymbol: "circle",
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
    tags: [],
    markerSymbol: "circle",
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
    tags: ["historic site"],
    markerSymbol: "tower",
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
    tags: ["business"],
    markerSymbol: "circle",
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
    type: "temple",
    tags: ["temple", "historic site"],
    markerSymbol: "temple",
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
    tags: [],
    markerSymbol: "circle",
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
    tags: [],
    markerSymbol: "circle",
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
    tags: [],
    markerSymbol: "diamond",
    x: 980,
    y: 1240,
    territory: "Euphrates Territory",
    factionAffinity: ["Surfer", "Neutral"],
    spoilerLevel: 1,
    description: "Placeholder — reposition in debug mode.",
  },
  {
    id: "aldebaran-territory",
    name: "Aldebaran Territory",
    type: "faction zone",
    tags: [],
    markerSymbol: "pentagon",
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
    tags: [],
    markerSymbol: "pentagon",
    x: 520,
    y: 1160,
    territory: "Euphrates Territory",
    factionAffinity: ["Sonic", "Surfer"],
    spoilerLevel: 0,
    description: "Placeholder region marker — reposition in debug mode.",
  },
];
