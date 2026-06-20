/**
 * Deck Builder view. The render half (`renderDeckBuilder`) is a PURE DOM builder
 * (no auth, no network) so it's unit-testable with jsdom: given a faction, the
 * card pool, the player's owned reward cards, and a starting deck, it shows the
 * available-card pool (starter + reward copies) with Add/Remove controls, a live
 * N/30 count, a validation banner, and Reset / Save. `mountDeckBuilder` loads the
 * session, faction, owned cards, and saved deck through the Auth backend, then
 * mounts the render half and persists on save.
 *
 * All deck rules come from ./deck-builder (which reuses the starter recipes and
 * reward-eligibility rules); this module is presentation + wiring only.
 */
import type { Card } from "@euphoria/card-data/schema";
import type { Auth } from "./auth";
import { cardImageUrl } from "./cards";
import { createCardDetail } from "./detail";
import { getPendingStore, syncPendingRewards } from "./pending-reward";
import type { OwnedCardRecord } from "./rewards";
import type { DeckEntry, StarterFaction } from "./starter";
import {
  availableCards,
  buildActiveDeckPayload,
  chooseActiveDeck,
  starterActiveDeck,
  validateActiveDeck,
  STARTER_DECK_SIZE,
  type AvailableCard,
  type DeckError,
} from "./deck-builder";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function cardArt(card: Card, base: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "deck-builder__art";
  img.loading = "lazy";
  img.src = cardImageUrl(card, base);
  img.alt = card.name;
  img.addEventListener("error", () => {
    img.removeAttribute("src");
    img.classList.add("deck-builder__art--missing");
  });
  return img;
}

/** A human-readable message for one validation error. */
function errorMessage(error: DeckError, nameOf: (slug: string) => string): string {
  switch (error.kind) {
    case "under":
      return `Deck has ${error.size}/${STARTER_DECK_SIZE} cards — add ${
        STARTER_DECK_SIZE - error.size
      } more.`;
    case "over":
      return `Deck has ${error.size}/${STARTER_DECK_SIZE} cards — remove ${
        error.size - STARTER_DECK_SIZE
      }.`;
    case "exceedsOwned":
      return `Too many copies of ${nameOf(error.slug)} — using ${error.used}, you own ${error.available}.`;
    case "ineligible":
      return `${nameOf(error.slug)} can't be used in this deck.`;
    case "unknown":
      return `Unknown card "${error.slug}".`;
  }
}

/** Props for the pure {@link renderDeckBuilder}. */
export interface DeckBuilderProps {
  readonly faction: StarterFaction;
  readonly pool: readonly Card[];
  readonly owned: readonly OwnedCardRecord[];
  /** The deck to start editing from (the saved deck or the starter deck). */
  readonly initialDeck: readonly DeckEntry[];
  /** Asset base path for card art. */
  readonly base: string;
  /** Called with the current deck when Save is clicked and the deck is valid. */
  readonly onSave: (entries: DeckEntry[]) => void | Promise<void>;
  /**
   * Called when a card's art/row is clicked to inspect it. When omitted, cards
   * are not interactive (e.g. in unit tests that don't exercise the modal).
   */
  readonly onInspect?: (card: Card) => void;
}

/**
 * Builds the deck-builder UI for one faction. Manages an in-memory working deck
 * (slug→quantity); Add/Remove re-render the panel. Pure: persistence happens via
 * the injected `onSave` callback.
 */
export function renderDeckBuilder(props: DeckBuilderProps): HTMLElement {
  const { faction, pool, owned, initialDeck, base, onSave, onInspect } = props;
  const nameOf = (slug: string): string =>
    pool.find((c) => c.slug === slug)?.name ?? slug;

  const root = document.createElement("section");
  root.className = "deck-builder";

  // Working deck as slug→quantity, seeded from the starting deck.
  const work = new Map<string, number>();
  const seed = (entries: readonly DeckEntry[]): void => {
    work.clear();
    for (const e of entries) work.set(e.slug, (work.get(e.slug) ?? 0) + e.quantity);
  };
  seed(initialDeck);

  const entries = (): DeckEntry[] =>
    [...work.entries()]
      .filter(([, q]) => q > 0)
      .map(([slug, quantity]) => ({ slug, quantity }));

  function cardRow(ac: AvailableCard): HTMLElement {
    const row = document.createElement("li");
    row.className = "deck-builder__card";
    row.dataset.slug = ac.card.slug;
    row.dataset.source = ac.source;

    const art = cardArt(ac.card, base);

    const text = document.createElement("div");
    text.className = "deck-builder__text";
    const rewardNote =
      ac.source === "both"
        ? `<span class="deck-builder__reward-note">+ reward copies</span>`
        : "";
    text.innerHTML =
      `<span class="deck-builder__name">${escapeHtml(ac.card.name)}</span>` +
      `<span class="deck-builder__meta">${escapeHtml(ac.card.faction)} · ${escapeHtml(ac.card.type)}</span>` +
      rewardNote;

    if (onInspect !== undefined) {
      // Clicking/tapping the art or row text opens the shared card-detail modal,
      // matching the Card Viewer. A real <button> gives focus + Enter/Space for
      // free; the +/− controls stay outside it so adjusting copies never inspects.
      const inspect = document.createElement("button");
      inspect.type = "button";
      inspect.className = "deck-builder__inspect";
      inspect.setAttribute("aria-label", `${ac.card.name} details`);
      inspect.addEventListener("click", () => onInspect(ac.card));
      inspect.append(art, text);
      row.append(inspect);
    } else {
      row.append(art, text);
    }

    const counts = document.createElement("span");
    counts.className = "deck-builder__counts";
    counts.textContent = `${ac.used} / ${ac.available}`;
    row.append(counts);

    const controls = document.createElement("div");
    controls.className = "deck-builder__controls";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "deck-builder__btn deck-builder__btn--remove";
    remove.textContent = "−";
    remove.setAttribute("aria-label", `Remove ${ac.card.name}`);
    remove.disabled = ac.used <= 0;
    remove.addEventListener("click", () => {
      work.set(ac.card.slug, Math.max(0, (work.get(ac.card.slug) ?? 0) - 1));
      rerender();
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "deck-builder__btn deck-builder__btn--add";
    add.textContent = "+";
    add.setAttribute("aria-label", `Add ${ac.card.name}`);
    add.disabled = ac.used >= ac.available;
    add.addEventListener("click", () => {
      const current = work.get(ac.card.slug) ?? 0;
      if (current < ac.available) {
        work.set(ac.card.slug, current + 1);
        rerender();
      }
    });

    controls.append(remove, add);
    row.append(controls);
    return row;
  }

  function group(title: string, cards: readonly AvailableCard[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "deck-builder__group";
    const heading = document.createElement("h3");
    heading.className = "deck-builder__group-heading";
    heading.textContent = `${title} (${cards.length})`;
    section.append(heading);
    const list = document.createElement("ul");
    list.className = "deck-builder__list";
    for (const ac of cards) list.append(cardRow(ac));
    section.append(list);
    return section;
  }

  function rerender(): void {
    const deck = entries();
    const validation = validateActiveDeck(deck, faction, pool, owned);
    const available = availableCards(faction, pool, owned, deck);

    const header = document.createElement("div");
    header.className = "deck-builder__header";
    const badge = document.createElement("span");
    badge.className =
      "deck-builder__count" +
      (validation.size === STARTER_DECK_SIZE ? "" : " deck-builder__count--invalid");
    badge.textContent = `${validation.size}/${STARTER_DECK_SIZE}`;
    header.innerHTML = `<h2 class="deck-builder__title">${escapeHtml(faction)} deck builder</h2>`;
    header.append(badge);

    const banner = document.createElement("div");
    banner.className = "deck-builder__banner";
    banner.setAttribute("role", "status");
    if (validation.valid) {
      banner.classList.add("deck-builder__banner--ok");
      banner.textContent = "Deck is valid and ready to save.";
    } else {
      banner.classList.add("deck-builder__banner--error");
      const ul = document.createElement("ul");
      ul.className = "deck-builder__errors";
      for (const err of validation.errors) {
        const li = document.createElement("li");
        li.textContent = errorMessage(err, nameOf);
        ul.append(li);
      }
      banner.append(ul);
    }

    const actions = document.createElement("div");
    actions.className = "deck-builder__actions";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "deck-builder__reset";
    reset.textContent = "Reset to starter deck";
    reset.addEventListener("click", () => {
      seed(starterActiveDeck(faction));
      rerender();
    });

    const save = document.createElement("button");
    save.type = "button";
    save.className = "deck-builder__save";
    save.textContent = "Save active deck";
    save.disabled = !validation.valid;

    const status = document.createElement("span");
    status.className = "deck-builder__status";
    status.setAttribute("role", "status");

    save.addEventListener("click", () => {
      if (!validation.valid) return;
      status.textContent = "Saving…";
      Promise.resolve(onSave(entries()))
        .then(() => {
          status.textContent = "Saved.";
        })
        .catch(() => {
          status.textContent = "Couldn't save — try again.";
        });
    });

    actions.append(reset, save, status);

    const starterCards = available.filter((c) => c.source !== "reward");
    const rewardCards = available.filter((c) => c.source === "reward");

    const pools = document.createElement("div");
    pools.className = "deck-builder__pools";
    pools.append(group("Starter cards", starterCards));
    if (rewardCards.length > 0) {
      pools.append(group("Owned reward cards", rewardCards));
    }

    root.replaceChildren(header, banner, actions, pools);
  }

  rerender();
  return root;
}

/** Options for {@link mountDeckBuilder}. */
export interface DeckBuilderOptions {
  readonly auth: Auth;
  readonly pool: readonly Card[];
  /** Asset base path for card art; defaults to "/". */
  readonly base?: string;
  /** Called after a successful save (e.g. so the app can refresh the account). */
  readonly onSaved?: () => void;
  /**
   * Called when the user clicks "Play match" with the builder's faction, so the
   * app can launch an interactive match using their resolved active deck.
   */
  readonly onPlayMatch?: (faction: StarterFaction) => void;
}

function notice(message: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "deck-builder deck-builder--notice";
  section.innerHTML =
    `<h2 class="deck-builder__title">Deck Builder</h2>` +
    `<p class="deck-builder__notice-body">${escapeHtml(message)}</p>`;
  return section;
}

/**
 * Loads the session, faction, owned cards, and saved deck, then mounts the deck
 * builder into `container`. Safe to call repeatedly (e.g. when the tab is shown
 * or after a save). Degrades to a prompt when signed out or no faction is chosen.
 */
export async function mountDeckBuilder(
  container: HTMLElement,
  options: DeckBuilderOptions,
): Promise<void> {
  const { auth, pool, base = "/", onSaved, onPlayMatch } = options;

  const session = await auth.getSession();
  if (session === null) {
    container.replaceChildren(
      notice("You're not signed in. Head to the Signup / Start tab first."),
    );
    return;
  }

  const profile = await auth.getProfile(session).catch(() => null);
  const faction = profile?.selected_faction ?? null;
  if (faction === null) {
    container.replaceChildren(
      notice("Choose a starter deck on the Starter Decks tab to build a deck."),
    );
    return;
  }

  // Retry any rewards that failed to save before loading owned cards, so synced
  // rewards appear in the available pool right away (no-op when nothing pending).
  await syncPendingRewards(auth, session, getPendingStore());

  const owned = await auth.getOwnedCards(session, 200).catch(() => []);
  const saved = await auth.getActiveDeck(session, faction).catch(() => null);
  const chosen = chooseActiveDeck(saved, faction, pool, owned);

  // One reusable detail modal for the whole panel, reused across re-renders and
  // shared behaviour with the Card Viewer (Esc / backdrop-click to close).
  const detail = createCardDetail(base);

  const view = renderDeckBuilder({
    faction,
    pool,
    owned,
    initialDeck: chosen.entries,
    base,
    onSave: (entries) =>
      auth
        .saveActiveDeck(
          session,
          buildActiveDeckPayload(session.userId, faction, entries),
        )
        .then(() => {
          onSaved?.();
        }),
    onInspect: (card) => detail.open(card),
  });

  const children: Node[] = [view];
  if (onPlayMatch !== undefined) {
    const bar = document.createElement("div");
    bar.className = "deck-builder__playbar";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "account__play deck-builder__play";
    play.textContent = "Play match with this deck";
    play.addEventListener("click", () => onPlayMatch(faction));
    bar.append(play);
    children.push(bar);
  }
  children.push(detail.element);
  container.replaceChildren(...children);
}
