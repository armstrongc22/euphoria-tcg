/**
 * App entry point. Renders a top header + tab navigation, then mounts two views:
 * the existing Card Viewer and the new Starter Decks page. Only one view is
 * shown at a time; the Card Viewer code path is unchanged — it's just wrapped in
 * a mount function so the tabs can host it.
 */
import "./styles.css";
import { cards } from "./cards";
import { renderControls } from "./controls";
import { createCardDetail } from "./detail";
import { DEFAULT_FILTERS, filterCards, type CardFilters } from "./filters";
import { renderGrid } from "./grid";
import { sortCards } from "./sort";
import { mountStarterDecks } from "./starter-view";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

type ViewId = "viewer" | "starter";

app.innerHTML = `
  <header class="site-header">
    <h1>Euphoria <span class="site-header__sub">TCG</span></h1>
    <p class="site-header__meta">${cards.length} cards · beta</p>
  </header>
  <nav class="site-nav" aria-label="Sections">
    <button type="button" class="site-nav__tab" data-view="viewer">Card Viewer</button>
    <button type="button" class="site-nav__tab" data-view="starter">Starter Decks</button>
  </nav>
  <div id="view-viewer" class="view"></div>
  <div id="view-starter" class="view" hidden></div>
  <footer class="site-footer">Euphoria TCG · beta</footer>
`;

const viewerEl = document.querySelector<HTMLElement>("#view-viewer")!;
const starterEl = document.querySelector<HTMLElement>("#view-starter")!;
const tabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".site-nav__tab"),
);

function showView(view: ViewId): void {
  viewerEl.hidden = view !== "viewer";
  starterEl.hidden = view !== "starter";
  for (const tab of tabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("site-nav__tab--active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => showView(tab.dataset.view as ViewId));
}

mountCardViewer(viewerEl);
mountStarterDecks(starterEl, cards);
showView("viewer");

/** Mounts the card viewer (filters + grid + detail modal) into a container. */
function mountCardViewer(root: HTMLElement): void {
  root.innerHTML = `
    <section id="controls" class="controls" aria-label="Filters"></section>
    <p id="count" class="result-count" role="status"></p>
    <main id="grid" class="card-grid" aria-label="Cards"></main>
  `;

  const controlsEl = root.querySelector<HTMLElement>("#controls")!;
  const countEl = root.querySelector<HTMLElement>("#count")!;
  const gridEl = root.querySelector<HTMLElement>("#grid")!;

  const detail = createCardDetail(import.meta.env.BASE_URL);
  document.body.append(detail.element);

  // Sort once; filtering preserves order.
  const ordered = sortCards(cards);
  let filters: CardFilters = { ...DEFAULT_FILTERS };

  function apply(): void {
    const visible = filterCards(ordered, filters);
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
}
