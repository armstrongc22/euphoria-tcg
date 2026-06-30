/**
 * Pure filtering + search for the public map exploration layer. No React/DOM so
 * the matching rules are unit-testable and shared by the toolbar and the map.
 * Notation/editor state lives elsewhere — these only ever read marker data.
 */

import type { MapMarker } from "./markers";

/** Sentinel "show every spoiler level" value for {@link MarkerFilters}. */
export const SPOILER_ALL = 99;

export interface MarkerFilters {
  /** Selected factions; empty = all. A marker matches if it shares any. */
  readonly factions: readonly string[];
  /** Selected marker types; empty = all. */
  readonly types: readonly string[];
  /** Selected tags; empty = all. A marker matches if it has any. */
  readonly tags: readonly string[];
  /** Hide markers whose spoilerLevel exceeds this (SPOILER_ALL = show all). */
  readonly maxSpoilerLevel: number;
}

export const EMPTY_FILTERS: MarkerFilters = {
  factions: [],
  types: [],
  tags: [],
  maxSpoilerLevel: SPOILER_ALL,
};

/** Unique, sorted list of every tag used across the markers (for the filter UI). */
export function collectTags(markers: readonly MapMarker[]): string[] {
  const set = new Set<string>();
  for (const m of markers) for (const t of m.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** How many filter facets are narrowing the view (for a toolbar badge). */
export function activeFilterCount(f: MarkerFilters): number {
  return (
    f.factions.length +
    f.types.length +
    f.tags.length +
    (f.maxSpoilerLevel < SPOILER_ALL ? 1 : 0)
  );
}

/** True when a marker passes every active filter facet (AND across facets). */
export function matchesFilters(m: MapMarker, f: MarkerFilters): boolean {
  if (
    f.factions.length > 0 &&
    !m.factionAffinity.some((x) => f.factions.includes(x))
  ) {
    return false;
  }
  if (f.types.length > 0 && !f.types.includes(m.type)) return false;
  if (f.tags.length > 0 && !m.tags.some((t) => f.tags.includes(t))) return false;
  if (m.spoilerLevel > f.maxSpoilerLevel) return false;
  return true;
}

/** Apply all filter facets, preserving order. */
export function filterMarkers(
  markers: readonly MapMarker[],
  f: MarkerFilters,
): MapMarker[] {
  return markers.filter((m) => matchesFilters(m, f));
}

/** Lowercased haystack of every searchable field on a marker. */
function haystack(m: MapMarker): string {
  return [
    m.name,
    m.type,
    m.territory,
    m.description,
    m.tags.join(" "),
    m.factionAffinity.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/** True when the (already trimmed+lowercased) query appears in any field. */
export function matchesSearch(m: MapMarker, query: string): boolean {
  if (query.length === 0) return false;
  return haystack(m).includes(query);
}

/**
 * Ranked search results across name/type/tags/territory/faction/description.
 * Empty query → no results. Name-prefix matches rank first, then name
 * substring, then any-field; ties break alphabetically.
 */
export function searchMarkers(
  markers: readonly MapMarker[],
  rawQuery: string,
): MapMarker[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];
  const rank = (m: MapMarker): number => {
    const name = m.name.toLowerCase();
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    return 2;
  };
  return markers
    .filter((m) => matchesSearch(m, query))
    .map((m, i) => ({ m, i }))
    .sort(
      (a, b) =>
        rank(a.m) - rank(b.m) ||
        a.m.name.localeCompare(b.m.name) ||
        a.i - b.i,
    )
    .map((e) => e.m);
}
