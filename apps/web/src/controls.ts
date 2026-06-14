/**
 * The filter bar: faction / type / cost selects plus a search box. It owns its
 * own copy of the filter state and notifies the caller on every change; the
 * pure matching lives in filters.ts.
 */
import type { Card } from "@euphoria/card-data/schema";
import {
  uniqueCosts,
  uniqueFactions,
  uniqueTypes,
  type CardFilters,
} from "./filters";

export function renderControls(
  container: HTMLElement,
  cards: readonly Card[],
  initial: CardFilters,
  onChange: (next: CardFilters) => void,
): void {
  const state: CardFilters = { ...initial };
  const emit = (patch: Partial<CardFilters>): void => {
    Object.assign(state, patch);
    onChange({ ...state });
  };

  const search = document.createElement("input");
  search.type = "search";
  search.className = "controls__search";
  search.placeholder = "Search name or rules text…";
  search.value = state.search;
  search.setAttribute("aria-label", "Search cards");
  search.addEventListener("input", () => emit({ search: search.value }));

  const faction = select(
    "Faction",
    ["all", ...uniqueFactions(cards)],
    state.faction,
    (v) => emit({ faction: v }),
  );
  const type = select(
    "Type",
    ["all", ...uniqueTypes(cards)],
    state.type,
    (v) => emit({ type: v }),
  );
  const cost = select(
    "Cost",
    ["all", ...uniqueCosts(cards).map(String)],
    state.cost,
    (v) => emit({ cost: v }),
  );

  container.replaceChildren(search, faction, type, cost);
}

/** A labelled <select>; the "all" option renders as "All". */
function select(
  label: string,
  values: readonly string[],
  selected: string,
  onSelect: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "controls__field";

  const text = document.createElement("span");
  text.className = "controls__label";
  text.textContent = label;

  const el = document.createElement("select");
  el.className = "controls__select";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "all" ? "All" : value;
    if (value === selected) option.selected = true;
    el.append(option);
  }
  el.addEventListener("change", () => onSelect(el.value));

  wrap.append(text, el);
  return wrap;
}
