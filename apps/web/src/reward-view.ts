/**
 * Reward chooser view. A PURE DOM builder (no auth, no network) so it can be
 * unit-tested with jsdom: given the 3 reward options ./rewards generated, it
 * renders one selectable card per option (art + name + type + faction) and
 * calls back with the chosen Card. Choosing disables the panel so a reward
 * can't be double-claimed.
 */
import type { Card } from "@euphoria/card-data/schema";
import { cardImageUrl } from "./cards";
import type { RewardTier } from "./rewards";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Options for {@link renderRewardChoice}. */
export interface RewardChoiceOptions {
  /** Asset base path (import.meta.env.BASE_URL) used for card art. */
  readonly base: string;
  /** Which pool the options came from; tunes the heading. Defaults to basic. */
  readonly tier?: RewardTier;
  /** The win milestone this reward is for, shown in the body when provided. */
  readonly milestone?: number;
}

/**
 * Builds the reward-choice panel shown after a match. `onChoose` fires once with
 * the picked card; further clicks are ignored (the panel disables itself).
 */
export function renderRewardChoice(
  options: readonly Card[],
  opts: RewardChoiceOptions,
  onChoose: (card: Card) => void,
): HTMLElement {
  const { base, tier = "basic", milestone } = opts;
  const panel = document.createElement("section");
  panel.className = `account__panel reward-choice reward-choice--${tier}`;

  const heading = document.createElement("h3");
  heading.className = "account__panel-heading";
  heading.textContent =
    tier === "enhanced" ? "Choose your enhanced reward" : "Choose your reward";
  panel.append(heading);

  const body = document.createElement("p");
  body.className = "account__panel-body";
  const milestoneText =
    milestone !== undefined ? ` Earned at ${milestone} wins.` : "";
  body.textContent =
    (tier === "enhanced"
      ? "An enhanced reward — stronger cards are more likely."
      : "Pick one card to add to your collection.") +
    ` This choice is final.${milestoneText}`;
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
    grid.append(button);
  }
  panel.append(grid);

  if (options.length === 0) {
    body.textContent = "No reward cards are available for your faction yet.";
  }

  return panel;
}
