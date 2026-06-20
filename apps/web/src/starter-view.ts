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

/**
 * One floating faction "product" card on the selection screen: name, faction
 * description, playstyle summary, a few featured card images, and a
 * "Choose this deck" button. Exported so the selection UI can be tested.
 */
export function renderFactionChoice(
  recipe: StarterRecipe,
  pool: readonly Card[],
  onChoose: (faction: StarterFaction) => void,
): HTMLElement {
  const featured = resolveFeatured(recipe, pool).slice(0, 3);

  const card = document.createElement("article");
  card.className = "faction-choice";
  card.dataset.faction = recipe.faction;

  const art = document.createElement("div");
  art.className = "faction-choice__art";
  for (const c of featured) {
    art.append(cardArt(c, "faction-choice__thumb"));
  }

  const body = document.createElement("div");
  body.className = "faction-choice__body";
  body.innerHTML =
    `<h3 class="faction-choice__name">${escapeHtml(recipe.faction)}</h3>` +
    `<p class="faction-choice__flavor">${escapeHtml(recipe.flavor)}</p>` +
    `<p class="faction-choice__playstyle"><span class="faction-choice__tag">Playstyle</span> ${escapeHtml(
      recipe.playstyle,
    )}</p>` +
    `<p class="faction-choice__count">${deckCardCount(recipe)}-card fixed starter deck</p>`;

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "faction-choice__cta";
  choose.dataset.faction = recipe.faction;
  choose.textContent = "Choose this deck";
  choose.addEventListener("click", () => onChoose(recipe.faction));

  body.append(choose);
  card.append(art, body);
  return card;
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

/** Options for {@link mountStarterDecks}. */
export interface StarterDecksOptions {
  /** If set, open straight to this deck (e.g. a returning player's pick). */
  readonly initialFaction?: StarterFaction | null;
  /**
   * The signed-in player's CURRENT faction, when they already have one. Choosing
   * a DIFFERENT faction is a destructive switch (it resets progression), so the
   * page shows a confirmation first and reports `resetProgression: true` to the
   * caller only after the player confirms. Null/undefined = no existing pick, so
   * any choice is a first-time selection with no reset.
   */
  readonly currentFaction?: StarterFaction | null;
  /**
   * Called when the visitor commits a deck, so the choice can be persisted.
   * `resetProgression` is true only for a confirmed switch away from an existing
   * different faction — the caller must then wipe progression before/with saving.
   */
  readonly onChoose?: (
    faction: StarterFaction,
    options: { resetProgression: boolean },
  ) => void;
}

/** Human-readable confirmation copy for a destructive starter switch. */
function switchConfirmBody(oldFaction: StarterFaction, newFaction: StarterFaction): string {
  return (
    `Changing from ${oldFaction} to ${newFaction} will reset your beta ` +
    "progression. You will lose earned reward cards, reward progress, saved " +
    "custom decks, and match history for this account. This cannot be undone."
  );
}

/**
 * Mounts the Starter Decks page into `container`. Two states:
 *   - "choosing": four floating faction product-cards, each with a
 *     "Choose this deck" button.
 *   - "chosen": that faction's fixed 30-card deck list, with a link back to the
 *     choices.
 * Recipes are frozen (./starter) — nothing is regenerated at runtime.
 */
export function mountStarterDecks(
  container: HTMLElement,
  pool: readonly Card[],
  options: StarterDecksOptions = {},
): void {
  const { initialFaction = null, currentFaction = null, onChoose } = options;

  container.innerHTML = `
    <section class="starter-intro">
      <h2 class="starter-intro__title">Choose your starter deck</h2>
      <p class="starter-intro__lead">Choose your starter deck. Play games. Earn reward cards. Upgrade your faction over time.</p>
      <p class="starter-intro__note">Beta signup is local preview for now. Real email capture will be connected before launch.</p>
    </section>
    <div id="starter-choices" class="starter-choices" role="group" aria-label="Starter faction decks"></div>
    <div id="starter-panel" class="starter-panel" aria-live="polite" hidden></div>
  `;

  const choicesEl = container.querySelector<HTMLElement>("#starter-choices")!;
  const panelEl = container.querySelector<HTMLElement>("#starter-panel")!;

  function showChoices(): void {
    panelEl.hidden = true;
    panelEl.replaceChildren();
    choicesEl.hidden = false;
    choicesEl.replaceChildren(
      ...STARTER_FACTIONS.map((faction) =>
        renderFactionChoice(getRecipe(faction), pool, choose),
      ),
    );
  }

  function showDeck(faction: StarterFaction): void {
    choicesEl.hidden = true;
    choicesEl.replaceChildren();

    const back = document.createElement("button");
    back.type = "button";
    back.className = "starter-back";
    back.textContent = "← Choose a different deck";
    back.addEventListener("click", showChoices);

    panelEl.hidden = false;
    panelEl.replaceChildren(back, renderDeckPanel(faction, pool));
  }

  // A non-dismissable confirm dialog for a destructive starter switch (Part B).
  function renderSwitchConfirm(
    oldFaction: StarterFaction,
    newFaction: StarterFaction,
    onConfirm: () => void,
    onCancel: () => void,
  ): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "starter-confirm";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const dialog = document.createElement("div");
    dialog.className = "starter-confirm__dialog";
    const h = document.createElement("h3");
    h.className = "starter-confirm__title";
    h.textContent = "Switch starter deck?";
    const p = document.createElement("p");
    p.className = "starter-confirm__body";
    p.textContent = switchConfirmBody(oldFaction, newFaction);
    const actions = document.createElement("div");
    actions.className = "starter-confirm__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "starter-confirm__cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", onCancel);
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "starter-confirm__confirm";
    confirm.textContent = "Yes, switch and reset";
    confirm.addEventListener("click", onConfirm);
    actions.append(cancel, confirm);
    dialog.append(h, p, actions);
    overlay.append(dialog);
    return overlay;
  }

  function commit(faction: StarterFaction, resetProgression: boolean): void {
    onChoose?.(faction, { resetProgression });
    showDeck(faction);
  }

  function choose(faction: StarterFaction): void {
    // A real switch away from an existing, different faction is destructive:
    // confirm first, and only then report resetProgression: true. First-time
    // picks and re-selecting the same faction commit immediately (no reset).
    if (currentFaction !== null && currentFaction !== faction) {
      const overlay = renderSwitchConfirm(
        currentFaction,
        faction,
        () => {
          overlay.remove();
          commit(faction, true);
        },
        () => overlay.remove(),
      );
      container.append(overlay);
      return;
    }
    commit(faction, false);
  }

  if (initialFaction !== null) {
    showDeck(initialFaction);
  } else {
    showChoices();
  }
}
