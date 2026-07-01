/**
 * Renders the card grid into a container. Pure DOM — no framework — building
 * one <figure> per card with lazy-loaded art and a faction data-attribute that
 * later filters and styling hook into.
 */
import type { Card } from "@euphoria/card-data";
import { cardImageUrl, cardThumbUrl } from "@euphoria/core/cards";

const BASE = import.meta.env.BASE_URL;

export function renderGrid(
  container: HTMLElement,
  list: readonly Card[],
  onSelect?: (card: Card) => void,
): void {
  container.replaceChildren(...list.map((card) => cardElement(card, onSelect)));
}

function cardElement(card: Card, onSelect?: (card: Card) => void): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "card";
  figure.dataset.faction = card.faction;
  figure.dataset.type = card.type;

  if (onSelect !== undefined) {
    figure.classList.add("card--interactive");
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", `${card.name} details`);
    figure.addEventListener("click", () => onSelect(card));
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(card);
      }
    });
  }

  const img = document.createElement("img");
  img.className = "card__art";
  img.loading = "lazy"; // offscreen collection cards defer until scrolled near
  img.decoding = "async";
  img.src = cardThumbUrl(card, BASE);
  img.alt = card.name;
  // If the optimized thumbnail is missing, fall back to the full-size PNG; only
  // then degrade to a styled placeholder (the caption still names the card).
  img.addEventListener("error", () => {
    if (img.dataset["fallback"] === undefined) {
      img.dataset["fallback"] = "1";
      img.src = cardImageUrl(card, BASE);
      return;
    }
    img.removeAttribute("src");
    img.classList.add("card__art--missing");
  });

  const caption = document.createElement("figcaption");
  caption.className = "card__caption";
  caption.innerHTML =
    `<span class="card__name">${escapeHtml(card.name)}</span>` +
    `<span class="card__tags">${card.faction} · ${card.type}</span>`;

  figure.append(img, caption);
  return figure;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
