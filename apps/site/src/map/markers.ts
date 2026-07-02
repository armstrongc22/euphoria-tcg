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

/** A labelled external/internal link for a marker's lore card. */
export interface RelatedLink {
  readonly label: string;
  readonly url: string;
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

  // ---- Optional lore cross-references (shown on the public card if present) ----
  readonly relatedCharacters?: readonly string[];
  readonly relatedArcs?: readonly string[];
  readonly relatedCards?: readonly string[];
  readonly relatedLinks?: readonly RelatedLink[];
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
      // Optional lore cross-references — same "only when present & valid" rule.
      ...optionalStringArray(r["relatedCharacters"], "relatedCharacters"),
      ...optionalStringArray(r["relatedArcs"], "relatedArcs"),
      ...optionalStringArray(r["relatedCards"], "relatedCards"),
      ...normalizeRelatedLinks(r["relatedLinks"]),
    },
  };
}

/** `{ [key]: string[] }` of trimmed non-empty strings, or `{}` when none. */
function optionalStringArray(
  value: unknown,
  key: string,
): Record<string, string[]> {
  if (!Array.isArray(value)) return {};
  const list = value
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? { [key]: list } : {};
}

/** Keep only well-formed {label,url} link objects; omit the field if none. */
function normalizeRelatedLinks(value: unknown): { relatedLinks?: RelatedLink[] } {
  if (!Array.isArray(value)) return {};
  const links: RelatedLink[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const label = typeof o["label"] === "string" ? o["label"].trim() : "";
    const url = typeof o["url"] === "string" ? o["url"].trim() : "";
    if (label.length > 0 && url.length > 0) links.push({ label, url });
  }
  return links.length > 0 ? { relatedLinks: links } : {};
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

// ---- Starter markers -------------------------------------------------------
// Curated default set (coordinates in the base map's natural 1122 x 1402 px),
// exported from notation mode. Used as the seed whenever no saved markers exist
// in localStorage; reposition/extend in debug mode and re-export to update.

export const STARTER_MARKERS: readonly MapMarker[] = [
  {
    id: "port-troy",
    name: "Port Troy",
    type: "city",
    tags: ["port"],
    markerSymbol: "circle",
    x: 630,
    y: 917,
    territory: "",
    factionAffinity: ["Human"],
    spoilerLevel: 0,
    description: "A major coastal trade hub.",
  },
  {
    id: "orange-court",
    name: "Orange Court",
    type: "city",
    tags: ["judicial citadel"],
    markerSymbol: "circle",
    x: 862,
    y: 907,
    territory: "Dwarf Nation",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "The judicial citadel of the Dwarf Nation.",
  },
  {
    id: "tarkana",
    name: "Tarkana",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 616,
    y: 502,
    territory: "",
    factionAffinity: ["Human"],
    spoilerLevel: 0,
    description: "Euphoria's trade mecca.",
  },
  {
    id: "seraphim-falls",
    name: "Seraphim Falls",
    type: "criminal location",
    tags: [],
    markerSymbol: "skull",
    x: 223,
    y: 1255,
    territory: "",
    factionAffinity: ["Criminal"],
    spoilerLevel: 1,
    description: "A criminal safe haven. A standing truce allows for illicit trade to flow seamlessly. Even bounty hunters and law enforcement respect the truce.",
  },
  {
    id: "metallstadt",
    name: "Metallstadt",
    type: "city",
    tags: ["capital"],
    markerSymbol: "circle",
    x: 1009,
    y: 691,
    territory: "Sonic Nation",
    factionAffinity: ["Sonic"],
    spoilerLevel: 0,
    description: "The capital city of the Sonic nation.",
  },
  {
    id: "musa",
    name: "Musa",
    type: "city",
    tags: ["capital"],
    markerSymbol: "circle",
    x: 754,
    y: 744,
    territory: "Dwarf Nation",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "The Dwarf Nation's capital.",
  },
  {
    id: "alta",
    name: "Alta",
    type: "submerged city",
    tags: [],
    markerSymbol: "diamond",
    x: 155,
    y: 677,
    territory: "Euphrates Territory",
    factionAffinity: ["Surfer"],
    spoilerLevel: 0,
    description: "The sister city of Marina.",
  },
  {
    id: "marina",
    name: "Marina",
    type: "submerged city",
    tags: [],
    markerSymbol: "diamond",
    x: 115,
    y: 803,
    territory: "Surfer Nation",
    factionAffinity: ["Surfer"],
    spoilerLevel: 0,
    description: "The capital city of the Surfer nation.",
  },
  {
    id: "twilight-islands",
    name: "Twilight Islands",
    type: "island",
    tags: [],
    markerSymbol: "circle",
    x: 66,
    y: 1076,
    territory: "",
    factionAffinity: ["Surfer", "Neutral"],
    spoilerLevel: 0,
    description: "A nine-island mega-resort.",
  },
  {
    id: "aldebaran-territory",
    name: "Aldebaran Territory",
    type: "faction zone",
    tags: ["lawless", "Dark Tribunal"],
    markerSymbol: "skull",
    x: 812,
    y: 150,
    territory: "Aldebaran Territory",
    factionAffinity: ["Criminal"],
    spoilerLevel: 0,
    description: "A lawless black sand desert controlled by the Dark Tribunal. Criminals that worship the Tribunal built a rebel nation around their hegemonic power, and now seek legitimacy.",
  },
  {
    id: "euphrates-territory",
    name: "Euphrates Territory",
    type: "territory",
    tags: [],
    markerSymbol: "circle",
    x: 792,
    y: 1195,
    territory: "",
    factionAffinity: ["Surfer"],
    spoilerLevel: 0,
    description: "A territory owned by the indigenous Surfers known as the Euphrates tribe.",
  },
  {
    id: "mt-k-rm-n",
    name: "Mt. Kármán",
    type: "historic site",
    tags: [],
    markerSymbol: "triangle",
    x: 506.74580276821507,
    y: 1133.1745304574795,
    territory: "",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "The highest point in Euphoria.",
  },
  {
    id: "gloria",
    name: "Gloria",
    type: "city",
    tags: ["tourism"],
    markerSymbol: "circle",
    x: 983,
    y: 859,
    territory: "Sonic Nation",
    factionAffinity: ["Sonic"],
    spoilerLevel: 0,
    description: "A tourism hub on the side of Saintglass Gorge 6,800 feet in the air.",
  },
  {
    id: "lahkt",
    name: "Lahkt",
    type: "city",
    tags: ["private-city"],
    markerSymbol: "circle",
    x: 425,
    y: 915,
    territory: "",
    factionAffinity: ["Human"],
    spoilerLevel: 0,
    description: "The private city made by Lahkt Brand Family Products.",
  },
  {
    id: "green-corridor",
    name: "Green Corridor",
    type: "territory",
    tags: [],
    markerSymbol: "pentagon",
    x: 421,
    y: 735,
    territory: "",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "A lush corridor of vibrant grassy plains. It is the most valuable real estate in Euphoria. Many of Euphoria's most powerful agencies and power brokers reside here.",
  },
  {
    id: "little-lake-national-park",
    name: "Little Lake National Park",
    type: "historic site",
    tags: [],
    markerSymbol: "scroll",
    x: 439,
    y: 359,
    territory: "",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "Site of the floating lake orb created during the Battle of Little Lake.",
  },
  {
    id: "atlas-land-bridge",
    name: "Atlas Land Bridge",
    type: "historic site",
    tags: [],
    markerSymbol: "scroll",
    x: 493,
    y: 1023,
    territory: "",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "Created by Rajah Atlas Alacapati",
  },
  {
    id: "ashe",
    name: "Ashe",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 282,
    y: 749,
    territory: "Monk Nation",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "The Monk nation's largest port.",
  },
  {
    id: "hellsmouth",
    name: "Hellsmouth",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 388,
    y: 962,
    territory: "",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "The gateway to the Monk nation.",
  },
  {
    id: "porta-carnage",
    name: "Porta Carnage",
    type: "criminal location",
    tags: [],
    markerSymbol: "skull",
    x: 508,
    y: 1293,
    territory: "",
    factionAffinity: ["Criminal"],
    spoilerLevel: 0,
    description: "\"Problem Child\" Rio's coastal party headquarters.",
  },
  {
    id: "surma",
    name: "Surma",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 305,
    y: 541,
    territory: "Monk Nation",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "A city designed to churn out high ranking soldiers and assassins.",
  },
  {
    id: "burne",
    name: "Burne",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 334,
    y: 358,
    territory: "",
    factionAffinity: ["Monk"],
    spoilerLevel: 0,
    description: "The Monk Nation's capital city.",
  },
  {
    id: "oko-forest",
    name: "Oko Forest",
    type: "historic site",
    tags: [],
    markerSymbol: "scroll",
    x: 991,
    y: 510,
    territory: "",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "A dense forest pulsating with an ancient magic.",
  },
  {
    id: "oko-temple",
    name: "Temple of Gia",
    type: "historic site",
    tags: [],
    markerSymbol: "temple",
    x: 1049,
    y: 425,
    territory: "Dwarf Nation",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "A temple older than all of recorded Euphorian history. It holds a magic connected to life itself.",
  },
  {
    id: "terrastinople",
    name: "Terrastinople",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 754,
    y: 625,
    territory: "",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "A metropolis built into a chasm. Terrastinople is the home of art, education, fashion, and music for the Dwarf Nation.",
  },
  {
    id: "shiva-s-marsh",
    name: "Shiva's Marsh",
    type: "criminal location",
    tags: [],
    markerSymbol: "skull",
    x: 194,
    y: 281,
    territory: "",
    factionAffinity: ["Surfer", "Criminal"],
    spoilerLevel: 0,
    description: "",
  },
  {
    id: "errongi",
    name: "Errongi",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 649,
    y: 735,
    territory: "Dwarf Nation",
    factionAffinity: ["Dwarf"],
    spoilerLevel: 0,
    description: "The gateway to the Dwarf Nation.",
  },
  {
    id: "deep-water-temple",
    name: "Deep Water Temple",
    type: "temple",
    tags: [],
    markerSymbol: "temple",
    x: 155,
    y: 909,
    territory: "",
    factionAffinity: [],
    spoilerLevel: 0,
    description: "A temple holding the sacred knowledge of the Surfer people.",
  },
  {
    id: "euphoria-coliseum",
    name: "Euphoria Coliseum",
    type: "historic site",
    tags: [],
    markerSymbol: "scroll",
    x: 766,
    y: 471,
    territory: "Oko Desert",
    factionAffinity: [],
    spoilerLevel: 0,
    description: "The site of the quadrennial Caelum Furor tournament.",
  },
  {
    id: "euphorian-senate",
    name: "Euphorian Senate",
    type: "historic site",
    tags: [],
    markerSymbol: "scroll",
    x: 431,
    y: 417,
    territory: "",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "The citadel of Euphorian politics.",
  },
  {
    id: "ness",
    name: "Ness",
    type: "criminal location",
    tags: [],
    markerSymbol: "skull",
    x: 57,
    y: 737,
    territory: "Surfer Nation",
    factionAffinity: ["Surfer", "Criminal"],
    spoilerLevel: 0,
    description: "Lost to the sea's depths, Ness is where all of the Surfer Nation's dregs reside.",
  },
  {
    id: "ember-city",
    name: "Ember City",
    type: "city",
    tags: [],
    markerSymbol: "skull",
    x: 352,
    y: 649,
    territory: "",
    factionAffinity: ["Monk", "Criminal"],
    spoilerLevel: 0,
    description: "A town run by the Iron Curtain syndicate.",
  },
  {
    id: "basalt-shelf",
    name: "Basalt Shelf",
    type: "territory",
    tags: [],
    markerSymbol: "hexagon",
    x: 671,
    y: 292,
    territory: "Basalt Shelf",
    factionAffinity: ["Neutral", "Criminal"],
    spoilerLevel: 0,
    description: "A range of basalt plates resting on a lake of lava. Criminals and rebels not cut out for Aldebaran, use the Basalt Shelf as a safe haven.",
  },
  {
    id: "toupti",
    name: "Toupti",
    type: "city",
    tags: [],
    markerSymbol: "circle",
    x: 531,
    y: 911,
    territory: "Greenskin",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "A mining town built by Edward Greenskin.",
  },
  {
    id: "uba-grand-resort-and-casino",
    name: "Uba Grand Resort and Casino",
    type: "business",
    tags: [],
    markerSymbol: "coin",
    x: 739,
    y: 423,
    territory: "",
    factionAffinity: ["Neutral"],
    spoilerLevel: 0,
    description: "A major resort for patrons of the Euphorian Coliseum",
  },
  {
    id: "battle-of-bloodfang",
    name: "Battle of Bloodfang",
    type: "battle site",
    tags: [],
    markerSymbol: "cross",
    x: 406,
    y: 1101,
    territory: "",
    factionAffinity: ["Monk", "Dwarf"],
    spoilerLevel: 0,
    description: "A 5 day battle over control over the only land route into the Holy Monk empire.",
  },
];
