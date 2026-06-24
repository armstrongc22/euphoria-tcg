/**
 * The filter bar: faction / type / cost selects, a search box, and a Clear
 * button. It owns its own copy of the filter state and notifies the caller on
 * every change; the pure matching lives in filters.ts.
 */
import type { Card } from "@euphoria/card-data/schema";
import {
  DEFAULT_FILTERS,
  uniqueCosts,
  uniqueFactions,
  uniqueTypes,
  type CardFilters,
} from "@euphoria/core/filters";

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

  const faction = select("Faction", ["all", ...uniqueFactions(cards)], state.faction);
  const type = select("Type", ["all", ...uniqueTypes(cards)], state.type);
  const cost = select("Cost", ["all", ...uniqueCosts(cards).map(String)], state.cost);
  faction.element.addEventListener("change", () => emit({ faction: faction.element.value }));
  type.element.addEventListener("change", () => emit({ type: type.element.value }));
  cost.element.addEventListener("change", () => emit({ cost: cost.element.value }));

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "controls__clear";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    search.value = DEFAULT_FILTERS.search;
    faction.element.value = DEFAULT_FILTERS.faction;
    type.element.value = DEFAULT_FILTERS.type;
    cost.element.value = DEFAULT_FILTERS.cost;
    emit({ ...DEFAULT_FILTERS });
  });

  container.replaceChildren(
    search,
    faction.field,
    type.field,
    cost.field,
    clear,
  );
}

/** A labelled <select>; the "all" option renders as "All". */
function select(
  label: string,
  values: readonly string[],
  selected: string,
): { field: HTMLElement; element: HTMLSelectElement } {
  const field = document.createElement("label");
  field.className = "controls__field";

  const text = document.createElement("span");
  text.className = "controls__label";
  text.textContent = label;

  const element = document.createElement("select");
  element.className = "controls__select";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "all" ? "All" : value;
    if (value === selected) option.selected = true;
    element.append(option);
  }

  field.append(text, element);
  return { field, element };
}
