/**
 * Reward chooser view. A PURE DOM builder (no auth, no network) so it can be
 * unit-tested with jsdom: given the 3 reward options ./rewards generated, it
 * renders one selectable card per option (art + name + type + faction) and
 * calls back with the chosen Card. Choosing disables the panel so a reward
 * can't be double-claimed.
 */
import type { Card } from "@euphoria/card-data/schema";
import { cardImageUrl } from "./cards";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Builds the reward-choice panel shown after a match. `base` is the asset base
 * path (import.meta.env.BASE_URL) used for card art. `onChoose` fires once with
 * the picked card; further clicks are ignored (the panel disables itself).
 */
export function renderRewardChoice(
  options: readonly Card[],
  base: string,
  onChoose: (card: Card) => void,
  /**
   * Optional: when provided, each option gets a "Details" button that calls back
   * to open the shared card-detail modal. Omitted in pure tests that don't
   * exercise the modal.
   */
  onInspect?: (card: Card) => void,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "account__panel reward-choice";

  const heading = document.createElement("h3");
  heading.className = "account__panel-heading";
  heading.textContent = "Choose your reward";
  panel.append(heading);

  const body = document.createElement("p");
  body.className = "account__panel-body";
  body.textContent =
    "Pick one card to add to your collection. This choice is final.";
  panel.append(body);

  const grid = document.createElement("div");
  grid.className = "reward-choice__options";

  let claimed = false;
  for (const card of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reward-choice__option";
    button.setAttribute("aria-label", `Choose ${card.name}`);
    button.innerHTML =
      `<img class="reward-choice__art" src="${escapeHtml(cardImageUrl(card, base))}" ` +
      `alt="" loading="lazy" />` +
      `<span class="reward-choice__name">${escapeHtml(card.name)}</span>` +
      `<span class="reward-choice__meta">${escapeHtml(card.faction)} · ${escapeHtml(card.type)}</span>`;
    button.addEventListener("click", () => {
      if (claimed) return;
      claimed = true;
      panel.classList.add("reward-choice--claimed");
      for (const b of grid.querySelectorAll("button")) b.disabled = true;
      button.classList.add("reward-choice__option--chosen");
      onChoose(card);
    });

    if (onInspect === undefined) {
      grid.append(button);
    } else {
      // Claim button + a separate Details button so inspecting never claims
      // (nested interactive elements would be invalid markup).
      const wrap = document.createElement("div");
      wrap.className = "reward-choice__card";
      const info = document.createElement("button");
      info.type = "button";
      info.className = "reward-choice__inspect";
      info.textContent = "Details";
      info.setAttribute("aria-label", `${card.name} details`);
      info.addEventListener("click", () => onInspect(card));
      wrap.append(button, info);
      grid.append(wrap);
    }
  }
  panel.append(grid);

  if (options.length === 0) {
    body.textContent = "No reward cards are available for your faction yet.";
  }

  return panel;
}

/**
 * Wraps {@link renderRewardChoice} in a fixed-position modal overlay so an
 * earned reward is shown immediately, centered, without the user scrolling. The
 * backdrop is non-dismissable — a reward must be claimed — but each card can be
 * inspected via `onInspect`. Returns the overlay element to append to a
 * container; the caller removes it after `onChoose` fires.
 */
export function renderRewardModal(
  options: readonly Card[],
  base: string,
  onChoose: (card: Card) => void,
  onInspect?: (card: Card) => void,
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "reward-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "reward-modal__backdrop";

  const dialog = document.createElement("div");
  dialog.className = "reward-modal__dialog";
  dialog.append(renderRewardChoice(options, base, onChoose, onInspect));

  overlay.append(backdrop, dialog);
  return overlay;
}
