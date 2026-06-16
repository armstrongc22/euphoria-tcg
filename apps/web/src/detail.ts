/**
 * Card detail view: a native <dialog> modal showing one card's art, stats, and
 * rules text. The field list is derived by a pure function (`cardDetailFields`)
 * so it can be unit-tested without the DOM.
 */
import type { Card } from "@euphoria/card-data/schema";
import { cardImageUrl } from "./cards";

export interface DetailField {
  label: string;
  value: string;
}

/** Per-instance counter so each dialog's title id is unique on the page. */
let detailInstanceCount = 0;

/** The labelled stat rows for a card; ATK/HP appear only when the card has them. */
export function cardDetailFields(card: Card): DetailField[] {
  const fields: DetailField[] = [
    { label: "Faction", value: card.faction },
    { label: "Type", value: card.type },
  ];
  if (card.subtype !== undefined && card.subtype !== "") {
    fields.push({ label: "Subtype", value: card.subtype });
  }
  fields.push({ label: "Cost", value: `${card.cost} Spirit` });
  if (typeof card.attack === "number") {
    fields.push({ label: "Attack", value: String(card.attack) });
  }
  if (typeof card.health === "number") {
    fields.push({ label: "Health", value: String(card.health) });
  }
  fields.push({ label: "Rarity", value: card.rarity });
  return fields;
}

/**
 * Creates a reusable detail dialog. `open(card)` populates and shows it; Esc
 * and a backdrop click close it (native <dialog> behaviour). Append the
 * returned element to the document once.
 */
export function createCardDetail(base: string): {
  element: HTMLDialogElement;
  open: (card: Card) => void;
} {
  const dialog = document.createElement("dialog");
  dialog.className = "detail";
  // Unique title id so multiple dialogs on one page (e.g. Card Viewer + Deck
  // Builder) don't collide on a shared id.
  const titleId = `detail-title-${(detailInstanceCount += 1)}`;
  // Associate the dialog with its card-name heading so screen readers announce
  // the card when the modal opens (the heading carries the matching id).
  dialog.setAttribute("aria-labelledby", titleId);
  // Close when the backdrop (the dialog element itself) is clicked.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const open = (card: Card): void => {
    dialog.replaceChildren(buildContent(card, base, titleId, () => dialog.close()));
    dialog.showModal();
  };

  return { element: dialog, open };
}

function buildContent(
  card: Card,
  base: string,
  titleId: string,
  onClose: () => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "detail__body";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "detail__close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "✕";
  close.addEventListener("click", onClose);

  const img = document.createElement("img");
  img.className = "detail__art";
  img.src = cardImageUrl(card, base);
  img.alt = card.name;
  // Mirror the grid: degrade gracefully to a styled placeholder if art is
  // missing instead of showing a broken-image icon.
  img.addEventListener("error", () => {
    img.removeAttribute("src");
    img.classList.add("detail__art--missing");
  });

  const info = document.createElement("div");
  info.className = "detail__info";

  const title = document.createElement("h2");
  title.className = "detail__name";
  title.id = titleId;
  title.textContent = card.name;

  const stats = document.createElement("dl");
  stats.className = "detail__stats";
  for (const field of cardDetailFields(card)) {
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.textContent = field.value;
    stats.append(dt, dd);
  }

  const rules = document.createElement("p");
  rules.className = "detail__rules";
  if (card.effectText.trim() !== "") {
    rules.textContent = card.effectText;
  } else {
    rules.classList.add("detail__rules--empty");
    rules.textContent = "No card text.";
  }

  info.append(title, stats, rules);
  root.append(close, img, info);
  return root;
}
