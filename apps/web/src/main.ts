/**
 * Card viewer entry point. Mounts the header, the filter bar, and the card
 * grid, re-rendering the grid (and a result count) whenever the filters change.
 * A card detail view layers on in a later increment.
 */
import "./styles.css";
import { cards } from "./cards";
import { renderControls } from "./controls";
import { createCardDetail } from "./detail";
import { DEFAULT_FILTERS, filterCards, type CardFilters } from "./filters";
import { renderGrid } from "./grid";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

app.innerHTML = `
  <header class="site-header">
    <h1>Euphoria <span class="site-header__sub">Card Viewer</span></h1>
    <p class="site-header__meta">${cards.length} cards · beta</p>
  </header>
  <section id="controls" class="controls" aria-label="Filters"></section>
  <p id="count" class="result-count" role="status"></p>
  <main id="grid" class="card-grid" aria-label="Cards"></main>
`;

const controlsEl = document.querySelector<HTMLElement>("#controls")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const gridEl = document.querySelector<HTMLElement>("#grid")!;

const detail = createCardDetail(import.meta.env.BASE_URL);
document.body.append(detail.element);

let filters: CardFilters = { ...DEFAULT_FILTERS };

function apply(): void {
  const visible = filterCards(cards, filters);
  countEl.textContent = `${visible.length} of ${cards.length} cards`;
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "card-grid__empty";
    empty.textContent = "No cards match these filters.";
    gridEl.replaceChildren(empty);
  } else {
    renderGrid(gridEl, visible, detail.open);
  }
}

renderControls(controlsEl, cards, filters, (next) => {
  filters = next;
  apply();
});
apply();
