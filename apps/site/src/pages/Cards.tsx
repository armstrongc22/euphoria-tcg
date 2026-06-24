import { useMemo, useState } from "react";
import { cards } from "@euphoria/core/cards";
import { filterCards, uniqueFactions, uniqueTypes } from "@euphoria/core/filters";
import { sortCards } from "@euphoria/core/sort";
import type { Card } from "../cards/types";
import { CardTile } from "../cards/CardTile";
import { CardDetailModal } from "../cards/CardDetailModal";
import { factionTone } from "../cards/factionTone";

// Control options are derived from the live data via the shared core helpers, so
// they always match what's actually in the archive.
const FACTIONS = uniqueFactions(cards);
const TYPES = uniqueTypes(cards);

type SortKey = "grouped" | "name" | "type" | "faction";

/** Apply the chosen sort. "grouped" reuses core's deterministic sortCards. */
function applySort(list: readonly Card[], key: SortKey): Card[] {
  switch (key) {
    case "name":
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    case "type":
      return [...list].sort(
        (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
      );
    case "faction":
      return [...list].sort(
        (a, b) =>
          a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name),
      );
    case "grouped":
    default:
      return sortCards(list);
  }
}

/**
 * The card database. Reads the real card list and the pure filter/sort logic
 * from @euphoria/core — the same source of truth the beta and engine use — with
 * no engine or schema changes. Faction/type filtering reuses core's
 * `filterCards`; name search is applied on top so it stays name-only.
 */
export function Cards() {
  const [search, setSearch] = useState("");
  const [faction, setFaction] = useState("all");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<SortKey>("grouped");
  const [selected, setSelected] = useState<Card | null>(null);

  const visible = useMemo(() => {
    // Faction + type via the shared core filter; cost left open here.
    const byFacets = filterCards(cards, {
      faction,
      type,
      cost: "all",
      search: "",
    });
    const query = search.trim().toLowerCase();
    const byName =
      query === ""
        ? byFacets
        : byFacets.filter((card) => card.name.toLowerCase().includes(query));
    return applySort(byName, sort);
  }, [search, faction, type, sort]);

  // Faction breakdown of the current results, in stable faction order.
  const factionSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of visible) {
      counts.set(card.faction, (counts.get(card.faction) ?? 0) + 1);
    }
    return FACTIONS.filter((name) => counts.has(name)).map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
  }, [visible]);

  const hasActiveFilters =
    search.trim() !== "" || faction !== "all" || type !== "all";

  function clearFilters(): void {
    setSearch("");
    setFaction("all");
    setType("all");
  }

  return (
    <div className="eu-page eu-page--blue eu-cards">
      <p className="eu-page__eyebrow">Card Archive</p>
      <h1 className="eu-page__title">Cards</h1>

      <div className="eu-cards__controls">
        <input
          className="eu-input"
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search cards by name"
        />
        <select
          className="eu-select"
          value={faction}
          onChange={(event) => setFaction(event.target.value)}
          aria-label="Filter by faction"
        >
          <option value="all">All factions</option>
          {FACTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="eu-select"
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-label="Filter by card type"
        >
          <option value="all">All types</option>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="eu-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          aria-label="Sort cards"
        >
          <option value="grouped">Sort: Grouped</option>
          <option value="name">Sort: Name</option>
          <option value="type">Sort: Type</option>
          <option value="faction">Sort: Faction</option>
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            className="eu-cards__clear"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="eu-cards__count">
        Showing <strong>{visible.length}</strong> of {cards.length} cards
        <span className="eu-cards__src">
          {" "}
          · data via <code>@euphoria/core</code>
        </span>
      </p>

      {factionSummary.length > 0 && (
        <div className="eu-cards__summary" aria-label="Results by faction">
          {factionSummary.map((entry) => (
            <span
              key={entry.name}
              className={`eu-chip eu-chip--${factionTone(entry.name)} eu-cards__summary-chip`}
            >
              {entry.name} <span className="eu-cards__summary-n">{entry.count}</span>
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="eu-cards__empty">No cards match those filters.</p>
      ) : (
        <div className="eu-card-grid">
          {visible.map((card) => (
            <CardTile key={card.id} card={card} onSelect={setSelected} />
          ))}
        </div>
      )}

      {selected !== null && (
        <CardDetailModal card={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
