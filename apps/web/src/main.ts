/**
 * Card viewer entry point. Mounts the header and the full card grid. Filters,
 * search, and a card detail view layer on in later increments.
 */
import "./styles.css";
import { cards } from "./cards";
import { renderGrid } from "./grid";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

app.innerHTML = `
  <header class="site-header">
    <h1>Euphoria <span class="site-header__sub">Card Viewer</span></h1>
    <p class="site-header__meta">${cards.length} cards · beta</p>
  </header>
  <main id="grid" class="card-grid" aria-label="All cards"></main>
`;

renderGrid(document.querySelector<HTMLElement>("#grid")!, cards);
