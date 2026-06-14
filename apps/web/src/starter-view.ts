/**
 * Starter Decks view. Pure DOM (no framework): a row of faction selector cards
 * at the top, the chosen faction's frozen deck list below (name, type, quantity,
 * image), a featured-cards spotlight, and a teaser for the upcoming reward-card
 * progression. The deck data comes from the frozen recipes in ./starter — nothing
 * is regenerated at runtime.
 */
import type { Card } from "@euphoria/card-data/schema";
import { cardImageUrl } from "./cards";
import {
  STARTER_FACTIONS,
  deckCardCount,
  getRecipe,
  resolveDeck,
  resolveFeatured,
  type StarterFaction,
  type StarterRecipe,
} from "./starter";

const BASE = import.meta.env.BASE_URL;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function cardArt(card: Card, className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.loading = "lazy";
  img.src = cardImageUrl(card, BASE);
  img.alt = card.name;
  // Degrade gracefully to a styled placeholder if art is missing.
  img.addEventListener("error", () => {
    img.removeAttribute("src");
    img.classList.add(`${className}--missing`);
  });
  return img;
}

/** One selectable faction tile in the top row. */
function selectorTile(
  recipe: StarterRecipe,
  selected: boolean,
  onSelect: (faction: StarterFaction) => void,
): HTMLElement {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "starter-tile";
  tile.dataset.faction = recipe.faction;
  tile.setAttribute("aria-pressed", String(selected));
  if (selected) tile.classList.add("starter-tile--selected");
  tile.innerHTML =
    `<span class="starter-tile__name">${escapeHtml(recipe.faction)}</span>` +
    `<span class="starter-tile__flavor">${escapeHtml(recipe.flavor)}</span>` +
    `<span class="starter-tile__playstyle">${escapeHtml(recipe.playstyle)}</span>` +
    `<span class="starter-tile__count">${deckCardCount(recipe)} cards · ${recipe.featured.length} featured</span>`;
  tile.addEventListener("click", () => onSelect(recipe.faction));
  return tile;
}

/** One row in the deck list: quantity, art thumbnail, name, and type. */
function deckRow(card: Card, quantity: number): HTMLElement {
  const row = document.createElement("li");
  row.className = "deck-row";
  row.dataset.faction = card.faction;
  row.dataset.type = card.type;

  const qty = document.createElement("span");
  qty.className = "deck-row__qty";
  qty.textContent = `${quantity}×`;

  const art = cardArt(card, "deck-row__art");

  const text = document.createElement("span");
  text.className = "deck-row__text";
  text.innerHTML =
    `<span class="deck-row__name">${escapeHtml(card.name)}</span>` +
    `<span class="deck-row__type">${escapeHtml(card.faction)} · ${escapeHtml(card.type)}</span>`;

  row.append(qty, art, text);
  return row;
}

/** The featured-cards spotlight for a faction. */
function featuredSection(cards: readonly Card[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "starter-featured";
  section.setAttribute("aria-label", "Featured cards");

  const heading = document.createElement("h3");
  heading.className = "starter-featured__heading";
  heading.textContent = "Featured cards";
  section.append(heading);

  const list = document.createElement("div");
  list.className = "starter-featured__grid";
  for (const card of cards) {
    const figure = document.createElement("figure");
    figure.className = "starter-featured__card";
    figure.dataset.faction = card.faction;
    const art = cardArt(card, "starter-featured__art");
    const caption = document.createElement("figcaption");
    caption.className = "starter-featured__caption";
    caption.textContent = card.name;
    figure.append(art, caption);
    list.append(figure);
  }
  section.append(list);
  return section;
}

/** The "play games to earn upgrades" teaser. */
function teaserSection(): HTMLElement {
  const teaser = document.createElement("section");
  teaser.className = "starter-teaser";
  teaser.innerHTML =
    `<h3 class="starter-teaser__heading">Play games to earn upgrades</h3>` +
    `<p class="starter-teaser__body">Reward-card progression is coming later. ` +
    `You'll keep your chosen starter deck and earn cards to customize and improve it over time. ` +
    `For now, these starter lists are fixed.</p>`;
  return teaser;
}

/**
 * Builds the full deck-list panel for a faction: a header with the deck's name
 * and total count, the featured spotlight, the row-by-row list, and the teaser.
 * Pure DOM builder, exported so it can be exercised in tests with jsdom.
 */
export function renderDeckPanel(
  faction: StarterFaction,
  pool: readonly Card[],
): HTMLElement {
  const recipe = getRecipe(faction);
  const resolved = resolveDeck(recipe, pool);
  const featured = resolveFeatured(recipe, pool);

  const panel = document.createElement("div");
  panel.className = "deck-panel";
  panel.dataset.faction = faction;

  const header = document.createElement("div");
  header.className = "deck-panel__header";
  header.innerHTML =
    `<h2 class="deck-panel__title">${escapeHtml(faction)} Starter Deck</h2>` +
    `<p class="deck-panel__meta">${deckCardCount(recipe)} cards · fixed starter list</p>`;
  panel.append(header);

  panel.append(featuredSection(featured));

  const listHeading = document.createElement("h3");
  listHeading.className = "deck-panel__list-heading";
  listHeading.textContent = "Deck list";
  panel.append(listHeading);

  const list = document.createElement("ul");
  list.className = "deck-list";
  list.setAttribute("aria-label", `${faction} starter deck list`);
  for (const { card, quantity } of resolved) {
    list.append(deckRow(card, quantity));
  }
  panel.append(list);

  panel.append(teaserSection());
  return panel;
}

/**
 * Mounts the Starter Decks page into `container`: the selector row plus a
 * detail panel that re-renders when a faction is chosen. Defaults to the first
 * faction.
 */
export function mountStarterDecks(
  container: HTMLElement,
  pool: readonly Card[],
): void {
  container.innerHTML = `
    <section class="starter-intro">
      <h2 class="starter-intro__title">Choose your starter deck</h2>
      <p class="starter-intro__lead">Pick one faction to play. Each is a fixed 30-card deck — no deck building yet.</p>
    </section>
    <div id="starter-selector" class="starter-selector" role="group" aria-label="Starter faction decks"></div>
    <div id="starter-panel" class="starter-panel" aria-live="polite"></div>
  `;

  const selectorEl = container.querySelector<HTMLElement>("#starter-selector")!;
  const panelEl = container.querySelector<HTMLElement>("#starter-panel")!;

  let selected: StarterFaction = STARTER_FACTIONS[0];

  function renderSelector(): void {
    selectorEl.replaceChildren(
      ...STARTER_FACTIONS.map((faction) =>
        selectorTile(getRecipe(faction), faction === selected, select),
      ),
    );
  }

  function renderPanel(): void {
    panelEl.replaceChildren(renderDeckPanel(selected, pool));
  }

  function select(faction: StarterFaction): void {
    if (faction === selected) return;
    selected = faction;
    renderSelector();
    renderPanel();
  }

  renderSelector();
  renderPanel();
}
