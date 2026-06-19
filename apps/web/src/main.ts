/**
 * App entry point. Renders a top header + tab navigation, then mounts four
 * views: the beta Signup / Start screen (the default landing), the Starter Decks
 * page, the Account page, and the existing Card Viewer. Only one view is shown at
 * a time; the Card Viewer code path is unchanged — it's just wrapped in a mount
 * function so the tabs can host it.
 *
 * Account state runs through the `Auth` backend (auth.ts): real Supabase accounts
 * when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set, otherwise the
 * localStorage demo fallback. Card data, the rules engine, and the simulator are
 * untouched.
 */
import "./styles.css";
import { mountAccount } from "./account-view";
import { createAuth, type AuthSession } from "./auth";
import { cards } from "./cards";
import { renderControls } from "./controls";
import { createCardDetail } from "./detail";
import { DEFAULT_FILTERS, filterCards, type CardFilters } from "./filters";
import { renderGrid } from "./grid";
import { mountSignup } from "./signup-view";
import { sortCards } from "./sort";
import { mountStarterDecks } from "./starter-view";
import { mountDeckBuilder } from "./deck-builder-view";
import { mountRules } from "./rules-view";
import { mountLore } from "./lore-view";
import type { StarterFaction } from "./starter";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

type ViewId =
  | "signup"
  | "starter"
  | "deckbuilder"
  | "account"
  | "viewer"
  | "rules"
  | "lore";

app.innerHTML = `
  <header class="site-header">
    <h1>Euphoria <span class="site-header__sub">TCG</span></h1>
    <p class="site-header__meta">${cards.length} cards · beta</p>
  </header>
  <nav class="site-nav" aria-label="Sections">
    <button type="button" class="site-nav__tab" data-view="signup">Signup / Start</button>
    <button type="button" class="site-nav__tab" data-view="starter">Starter Decks</button>
    <button type="button" class="site-nav__tab" data-view="deckbuilder">Deck Builder</button>
    <button type="button" class="site-nav__tab" data-view="account">Account</button>
    <button type="button" class="site-nav__tab" data-view="viewer">Card Viewer</button>
    <button type="button" class="site-nav__tab" data-view="rules">Rules</button>
    <button type="button" class="site-nav__tab" data-view="lore">Lore</button>
  </nav>
  <div id="view-signup" class="view"></div>
  <div id="view-starter" class="view" hidden></div>
  <div id="view-deckbuilder" class="view" hidden></div>
  <div id="view-account" class="view" hidden></div>
  <div id="view-viewer" class="view" hidden></div>
  <div id="view-rules" class="view" hidden></div>
  <div id="view-lore" class="view" hidden></div>
  <footer class="site-footer">Euphoria TCG · beta</footer>
`;

const signupEl = document.querySelector<HTMLElement>("#view-signup")!;
const starterEl = document.querySelector<HTMLElement>("#view-starter")!;
const deckBuilderEl = document.querySelector<HTMLElement>("#view-deckbuilder")!;
const accountEl = document.querySelector<HTMLElement>("#view-account")!;
const viewerEl = document.querySelector<HTMLElement>("#view-viewer")!;
const rulesEl = document.querySelector<HTMLElement>("#view-rules")!;
const loreEl = document.querySelector<HTMLElement>("#view-lore")!;
const tabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".site-nav__tab"),
);

function showView(view: ViewId): void {
  signupEl.hidden = view !== "signup";
  starterEl.hidden = view !== "starter";
  deckBuilderEl.hidden = view !== "deckbuilder";
  accountEl.hidden = view !== "account";
  viewerEl.hidden = view !== "viewer";
  rulesEl.hidden = view !== "rules";
  loreEl.hidden = view !== "lore";
  for (const tab of tabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("site-nav__tab--active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  }
  // The account and deck-builder views reflect live session/profile state, so
  // re-render on show.
  if (view === "account") void refreshAccount();
  if (view === "deckbuilder") void refreshDeckBuilder();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => showView(tab.dataset.view as ViewId));
}

// Pick the backend once: Supabase if configured, else the localStorage demo.
const auth = createAuth();

// The session the rest of the flow operates on; set on signup, cleared on sign out.
let session: AuthSession | null = null;

// Set when the user clicks "Play match" in the Deck Builder: the account view
// reads it once on its next mount to launch straight into the interactive match,
// then it is cleared so ordinary account visits show the card.
let pendingPlay: StarterFaction | null = null;

async function refreshAccount(): Promise<void> {
  const autoPlay = pendingPlay;
  pendingPlay = null;
  await mountAccount(accountEl, {
    auth,
    pool: cards,
    base: import.meta.env.BASE_URL,
    autoPlay: autoPlay ?? undefined,
    onSignOut: () => {
      session = null;
      void renderSignup();
      mountStarter(null);
      showView("signup");
    },
  });
}

async function refreshDeckBuilder(): Promise<void> {
  await mountDeckBuilder(deckBuilderEl, {
    auth,
    pool: cards,
    base: import.meta.env.BASE_URL,
    // A saved deck changes the account's "Active deck" line, so refresh it.
    onSaved: () => void refreshAccount(),
    // Launch the interactive match from the builder: stash the faction and
    // switch to the account tab, which reads pendingPlay and starts the match.
    onPlayMatch: (faction) => {
      pendingPlay = faction;
      showView("account");
    },
  });
}

async function renderSignup(): Promise<void> {
  await mountSignup(signupEl, {
    auth,
    onContinue: (next) => {
      session = next;
      showView("starter");
    },
  });
}

function mountStarter(initialFaction: StarterFaction | null): void {
  mountStarterDecks(starterEl, cards, {
    initialFaction,
    onChoose: (faction) => {
      // Persist the choice on the profile, then send the player to their account.
      void Promise.resolve(session ?? auth.getSession())
        .then((s) => (s !== null ? auth.saveFaction(s, faction) : undefined))
        .finally(() => showView("account"));
    },
  });
}

mountCardViewer(viewerEl);

// Rules and Lore are static content — mount once at boot (no session/profile).
mountRules(rulesEl);
mountLore(loreEl);

// Boot: restore any existing session, then render signup + starter accordingly.
void (async () => {
  session = await auth.getSession().catch(() => null);
  const profile = session ? await auth.getProfile(session).catch(() => null) : null;
  await renderSignup();
  mountStarter(profile?.selected_faction ?? null);
  // Signup / Start is the default landing view.
  showView("signup");
})();

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
