/**
 * Game-client shell entry point. Wraps the existing beta views (signup, starter,
 * account/match, deck builder, card viewer, rules, lore) in a single cinematic
 * client: a splash/title screen → a main menu → full-screen internal screens.
 * There is no public website navbar; navigation is game-style (menu + HUD).
 *
 * IMPORTANT: this is a UI-shell refactor only. The battle engine, reward logic,
 * deck validation, auth, and Supabase persistence are unchanged — each existing
 * view mount function is reused verbatim; only how they're hosted/navigated
 * changed. Account state runs through the `Auth` backend (Supabase when
 * VITE_SUPABASE_* are set, else the localStorage demo).
 */
import "./styles.css";
import "./game-shell.css";
import { mountAccount } from "./account-view";
import { createAuth, type AuthSession } from "@euphoria/core/auth";
import { cards } from "@euphoria/core/cards";
import { renderControls } from "./controls";
import { createCardDetail } from "./detail";
import { DEFAULT_FILTERS, filterCards, type CardFilters } from "@euphoria/core/filters";
import { renderGrid } from "./grid";
import { mountSignup } from "./signup-view";
import { sortCards } from "@euphoria/core/sort";
import { mountStarterDecks } from "./starter-view";
import { mountDeckBuilder } from "./deck-builder-view";
import { mountRules } from "./rules-view";
import { mountLore } from "./lore-view";
import { installDiagnostics, setBuildStamp } from "@euphoria/core/debug-log";
import { openFeedbackModal } from "./feedback-view";
import { FLAG_DEBUG, flag, setFlag } from "./debug-flags";
import { getRecoveryStore } from "@euphoria/core/match-recovery";
import { getPendingStore, syncPendingRewards } from "@euphoria/core/pending-reward";
import { resetAllProgression } from "@euphoria/core/progression";
import { nextRewardMilestone } from "@euphoria/core/rewards";
import type { StarterFaction } from "@euphoria/core/starter";

// Build stamp (set by vite.config define): the deployed commit/timestamp, shown
// in the footer, on window, and in the debug panel so a tester can confirm the
// page isn't a stale cached asset. Falls back to "dev" when running unbuilt.
const BUILD_STAMP: string = import.meta.env.VITE_BUILD_STAMP ?? "dev";
(window as Window & { __EUPHORIA_BUILD__?: string }).__EUPHORIA_BUILD__ = BUILD_STAMP;
setBuildStamp(BUILD_STAMP);

// Opt-in mobile diagnostics (localStorage.euphoriaDebug = "1"): captures uncaught
// errors, promise rejections, and page lifecycle to help chase the mobile reload.
// A no-op unless the flag is set; installed before anything else runs.
installDiagnostics();

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

// Internal screens (each hosts an existing view). "menu"/"splash" are shell
// states, not view containers.
type ViewId =
  | "signup"
  | "starter"
  | "deckbuilder"
  | "account"
  | "viewer"
  | "rules"
  | "lore"
  | "settings";

const SCREEN_TITLES: Record<ViewId, string> = {
  signup: "Account",
  starter: "Choose Your Faction",
  deckbuilder: "Deck Editor",
  account: "Command Center",
  viewer: "Collection",
  rules: "Rules",
  lore: "Lore",
  settings: "Settings",
};

// The public map lives on the parent site at /map (the beta is served under
// /beta/). Strip the trailing "beta/" from the base to reach it.
const MAP_URL = `${import.meta.env.BASE_URL.replace(/beta\/$/, "")}map`;

// Skip the splash for the rest of the browser session once entered.
const ENTERED_KEY = "euphoria_beta_entered";

const ORBS: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Monk", color: "var(--f-monk)" },
  { name: "Dwarf", color: "var(--f-dwarf)" },
  { name: "Surfer", color: "var(--f-surfer)" },
  { name: "Sonic", color: "var(--f-sonic)" },
  { name: "Shaman", color: "var(--f-shaman)" },
  { name: "Human", color: "var(--f-human)" },
  { name: "Neutral", color: "var(--f-neutral)" },
  { name: "Criminal", color: "var(--f-criminal)" },
];

app.innerHTML = `
  <div class="gc" data-screen="splash">
    <section class="gc-splash" id="gc-splash">
      <div class="gc-splash__orbs" aria-hidden="true">
        ${ORBS.map(
          (o, i) =>
            `<span class="gc-orb" style="--orb:${o.color};--d:${(i * 0.18).toFixed(2)}s"></span>`,
        ).join("")}
      </div>
      <h1 class="gc-title">EUPHORIA</h1>
      <p class="gc-title__sub">Trading Card Game · Beta</p>
      <button type="button" class="gc-btn--enter" id="gc-enter">Enter Beta</button>
      <p class="gc-splash__hint">tap anywhere to continue</p>
    </section>

    <div class="gc-shell" id="gc-shell" hidden>
      <header class="gc-hud">
        <button type="button" class="gc-hud__btn" id="gc-menu-btn" aria-label="Main menu">☰ Menu</button>
        <span class="gc-hud__title" id="gc-screen-title">Euphoria</span>
        <button type="button" class="gc-hud__btn" id="gc-account-btn">Account</button>
      </header>

      <section class="gc-menu" id="gc-menu">
        <h1 class="gc-title">EUPHORIA</h1>
        <div class="gc-status" id="gc-status"></div>
        <nav class="gc-menu__actions" aria-label="Game menu">
          <button type="button" class="gc-action gc-action--primary" data-go="play">
            <span class="gc-action__label">▶ Start Match</span>
            <span class="gc-action__hint">Battle the AI with your deck</span>
          </button>
          <button type="button" class="gc-action" data-go="deckbuilder">
            <span class="gc-action__label">Deck Editor</span>
            <span class="gc-action__hint">Build & save your deck</span>
          </button>
          <button type="button" class="gc-action" data-go="viewer">
            <span class="gc-action__label">Collection</span>
            <span class="gc-action__hint">Browse the card archive</span>
          </button>
          <button type="button" class="gc-action" data-go="rewards">
            <span class="gc-action__label">Rewards</span>
            <span class="gc-action__hint">Progress & owned cards</span>
          </button>
          <button type="button" class="gc-action" data-go="map">
            <span class="gc-action__label">World Map</span>
            <span class="gc-action__hint">Explore Euphoria</span>
          </button>
          <button type="button" class="gc-action" data-go="settings">
            <span class="gc-action__label">Settings</span>
            <span class="gc-action__hint">Account, music & options</span>
          </button>
        </nav>
        <div class="gc-menu__secondary">
          <button type="button" class="gc-link" data-go="signup" id="gc-auth-link">Sign In / Account</button>
          <button type="button" class="gc-link" data-go="rules">Rules</button>
          <button type="button" class="gc-link" data-go="lore">Lore</button>
        </div>
      </section>

      <div class="gc-screen" id="gc-screen" hidden>
        <div class="gc-screen__inner">
          <div id="view-signup" class="view gc-view" hidden></div>
          <div id="view-starter" class="view gc-view" hidden></div>
          <div id="view-deckbuilder" class="view gc-view" hidden></div>
          <div id="view-account" class="view gc-view" hidden></div>
          <div id="view-viewer" class="view gc-view" hidden></div>
          <div id="view-rules" class="view gc-view" hidden></div>
          <div id="view-lore" class="view gc-view" hidden></div>
          <div id="view-settings" class="view gc-view" hidden>
            <div class="gc-settings">
              <section class="gc-panel">
                <h2 class="gc-panel__title">Account</h2>
                <p class="gc-panel__line" id="gc-settings-account">—</p>
                <button type="button" class="gc-btn" id="gc-settings-manage">Manage account</button>
              </section>

              <!-- Future-ready soundtrack area. No third-party player is loaded;
                   this is a placeholder wired for a future original/licensed
                   Euphoria OST (see the disabled control below). -->
              <section class="gc-panel gc-panel--ost" aria-labelledby="gc-ost-title">
                <div class="gc-panel__head">
                  <h2 class="gc-panel__title" id="gc-ost-title">Music / OST</h2>
                  <span class="gc-badge">Coming soon</span>
                </div>
                <p class="gc-panel__line">
                  An original Euphoria soundtrack is planned for a future update.
                </p>
                <div class="gc-ost" aria-hidden="true">
                  <button type="button" class="gc-ost__play" disabled>▶</button>
                  <div class="gc-ost__track">
                    <span class="gc-ost__name">Soundtrack coming soon</span>
                    <div class="gc-ost__bar"><span></span></div>
                  </div>
                </div>
                <label class="gc-ost__toggle">
                  <input type="checkbox" disabled />
                  <span>Enable music (available in a future release)</span>
                </label>
              </section>
            </div>
          </div>
        </div>
      </div>

      <footer class="gc-foot">
        Euphoria TCG · beta ·
        <button type="button" id="build-stamp" class="site-footer__stamp" title="Build version">build ${BUILD_STAMP}</button>
        · <button type="button" id="footer-feedback" class="gc-foot__link">Send feedback</button>
      </footer>
    </div>
  </div>
`;

const gc = document.querySelector<HTMLElement>(".gc")!;
const splashEl = document.querySelector<HTMLElement>("#gc-splash")!;
const shellEl = document.querySelector<HTMLElement>("#gc-shell")!;
const menuEl = document.querySelector<HTMLElement>("#gc-menu")!;
const screenHost = document.querySelector<HTMLElement>("#gc-screen")!;
const screenTitle = document.querySelector<HTMLElement>("#gc-screen-title")!;
const statusEl = document.querySelector<HTMLElement>("#gc-status")!;
const authLink = document.querySelector<HTMLButtonElement>("#gc-auth-link")!;

const signupEl = document.querySelector<HTMLElement>("#view-signup")!;
const starterEl = document.querySelector<HTMLElement>("#view-starter")!;
const deckBuilderEl = document.querySelector<HTMLElement>("#view-deckbuilder")!;
const accountEl = document.querySelector<HTMLElement>("#view-account")!;
const viewerEl = document.querySelector<HTMLElement>("#view-viewer")!;
const rulesEl = document.querySelector<HTMLElement>("#view-rules")!;
const loreEl = document.querySelector<HTMLElement>("#view-lore")!;
const settingsEl = document.querySelector<HTMLElement>("#view-settings")!;
const viewEls: Record<ViewId, HTMLElement> = {
  signup: signupEl,
  starter: starterEl,
  deckbuilder: deckBuilderEl,
  account: accountEl,
  viewer: viewerEl,
  rules: rulesEl,
  lore: loreEl,
  settings: settingsEl,
};

// Hidden debug reveal (unchanged): tapping the build stamp 5 times toggles the
// diagnostics + in-app debug panel on/off — so normal users never see a debug
// control, but a mobile tester can enable it without a console. Taps must be in
// quick succession (the counter resets after a short idle gap). Reflects the
// current flag (the stamp lights teal when debug is on). The toggle reloads so
// installDiagnostics() / the panel re-initialize cleanly for the new state.
const REVEAL_TAPS = 5;
const REVEAL_RESET_MS = 1200;
const buildStamp = document.querySelector<HTMLButtonElement>("#build-stamp");
if (buildStamp !== null) {
  const syncStamp = (): void => {
    const on = flag(FLAG_DEBUG);
    buildStamp.classList.toggle("site-footer__stamp--debug", on);
    buildStamp.setAttribute("aria-pressed", on ? "true" : "false");
  };
  let taps = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  buildStamp.addEventListener("click", () => {
    taps += 1;
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    if (taps >= REVEAL_TAPS) {
      taps = 0;
      setFlag(FLAG_DEBUG, !flag(FLAG_DEBUG));
      syncStamp();
      // Reload so diagnostics capture + the panel mount cleanly. Guarded: jsdom
      // (tests) has no navigation, so swallow the "not implemented".
      try {
        location.reload();
      } catch {
        /* no navigation available (test env) — the flag change still applies */
      }
      return;
    }
    resetTimer = setTimeout(() => {
      taps = 0;
    }, REVEAL_RESET_MS);
  });
  syncStamp();
}

// The view/state currently on screen — read by the footer feedback context.
let currentView: ViewId | "menu" | "splash" = "splash";

// Pick the backend once: Supabase if configured, else the localStorage demo.
const auth = createAuth();

// The session the rest of the flow operates on; set on signup, cleared on sign out.
let session: AuthSession | null = null;

// Set when the user launches a match: the account view reads it once on its next
// mount to jump straight into the interactive match, then clears it.
let pendingPlay: StarterFaction | null = null;

// The signed-in player's current starter faction (null when none). Used to detect
// a destructive starter switch and to seed the starter page's open state.
let currentFaction: StarterFaction | null = null;

// ---- Shell navigation ----------------------------------------------------

/** Scroll to top on screen change; guarded for jsdom (no scrollTo). */
function scrollTop(): void {
  try {
    window.scrollTo(0, 0);
  } catch {
    /* no scroll in test env */
  }
}

function showScreen(view: ViewId, opts?: { autoPlay?: StarterFaction }): void {
  currentView = view;
  gc.dataset.screen = "screen";
  menuEl.hidden = true;
  screenHost.hidden = false;
  for (const id of Object.keys(viewEls) as ViewId[]) {
    viewEls[id].hidden = id !== view;
  }
  screenTitle.textContent = SCREEN_TITLES[view];

  // Dynamic views reflect live session/profile state, so (re)mount on show.
  if (view === "account") {
    if (opts?.autoPlay !== undefined) pendingPlay = opts.autoPlay;
    void refreshAccount();
  } else if (view === "deckbuilder") {
    void refreshDeckBuilder();
  } else if (view === "signup") {
    void renderSignup();
  } else if (view === "starter") {
    mountStarter(currentFaction);
  } else if (view === "settings") {
    updateSettings();
  }
  // viewer / rules / lore are static — mounted once at boot.
  scrollTop();
}

/** Reflect sign-in state in the Settings screen (the OST area is static). */
function updateSettings(): void {
  const line = document.querySelector<HTMLElement>("#gc-settings-account");
  if (line === null) return;
  line.textContent =
    session !== null
      ? `Signed in as ${session.email ?? "player"}`
      : "Not signed in — open Account to sign in or create an account.";
}

function showMenu(): void {
  currentView = "menu";
  gc.dataset.screen = "menu";
  screenHost.hidden = true;
  menuEl.hidden = false;
  void updateMenuStatus();
  scrollTop();
}

function enterShell(): void {
  try {
    sessionStorage.setItem(ENTERED_KEY, "1");
  } catch {
    /* private mode — splash just shows each load */
  }
  splashEl.hidden = true;
  shellEl.hidden = false;
  showMenu();
}

/** Menu status: sign-in state, selected faction, and win/reward progress. */
async function updateMenuStatus(): Promise<void> {
  const chips: string[] = [];
  if (session !== null) {
    const who = session.email ?? "Player";
    chips.push(`<span class="gc-status__chip gc-status__chip--accent">◆ ${escapeHtml(who)}</span>`);
    authLink.textContent = "Account";
  } else {
    chips.push(`<span class="gc-status__chip gc-status__chip--muted">Not signed in</span>`);
    authLink.textContent = "Sign In / Create Account";
  }
  chips.push(
    `<span class="gc-status__chip">${currentFaction !== null ? `Faction: ${escapeHtml(currentFaction)}` : "No deck selected"}</span>`,
  );
  statusEl.innerHTML = chips.join("");

  // Win/reward progress (best-effort; skipped when signed out or on error).
  if (session !== null) {
    const stats = await auth.getMatchStats(session).catch(() => null);
    if (stats !== null && gc.dataset.screen === "menu") {
      const next = nextRewardMilestone(stats.wins);
      const extra = document.createElement("span");
      extra.className = "gc-status__chip";
      extra.textContent = `${stats.wins} wins · next reward at ${next}`;
      statusEl.append(extra);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

// ---- View wiring (unchanged behavior; only navigation targets updated) ----

async function refreshAccount(): Promise<void> {
  const autoPlay = pendingPlay;
  pendingPlay = null;
  await mountAccount(accountEl, {
    auth,
    pool: cards,
    base: import.meta.env.BASE_URL,
    autoPlay: autoPlay ?? undefined,
    // Onboarding next-step CTA can send the player to another screen.
    onNavigate: (screen) => showScreen(screen),
    onSignOut: () => {
      session = null;
      currentFaction = null;
      void renderSignup();
      mountStarter(null);
      showMenu();
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
    // Launch the interactive match from the builder.
    onPlayMatch: (faction) => {
      pendingPlay = faction;
      showScreen("account");
    },
  });
}

async function renderSignup(): Promise<void> {
  await mountSignup(signupEl, {
    auth,
    onContinue: (next) => {
      session = next;
      showScreen("starter");
    },
  });
}

function mountStarter(initialFaction: StarterFaction | null): void {
  currentFaction = initialFaction;
  mountStarterDecks(starterEl, cards, {
    initialFaction,
    // The current pick drives switch-confirmation: choosing a different faction
    // is destructive and the starter page confirms before reporting reset:true.
    currentFaction: initialFaction,
    onViewRules: () => showScreen("rules"),
    onPlayMatch: (faction) => {
      pendingPlay = faction;
      showScreen("account");
    },
    onChoose: (faction, { resetProgression }) => {
      void (async () => {
        const s = session ?? (await auth.getSession().catch(() => null));
        if (s !== null) {
          // Confirmed switch: wipe ALL progression (backend rows + resume snapshot
          // + pending reward queue) BEFORE changing the faction, so the account /
          // deck builder reload a clean, new-starter baseline.
          if (resetProgression) {
            await resetAllProgression(auth, s, {
              recovery: getRecoveryStore(),
              pending: getPendingStore(),
            });
          }
          await auth.saveFaction(s, faction).catch(() => {});
          currentFaction = faction;
        }
        showScreen("account");
      })();
    },
  });
}

// ---- Menu / HUD / splash wiring ------------------------------------------

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-go]")) {
  btn.addEventListener("click", () => {
    const go = btn.dataset.go!;
    switch (go) {
      case "play":
        // Start a match: jump into the board with the selected faction, or send
        // the player to pick a starter first if they have none.
        if (currentFaction !== null) showScreen("account", { autoPlay: currentFaction });
        else showScreen("starter");
        break;
      case "rewards":
        showScreen("account");
        break;
      case "map":
        window.location.assign(MAP_URL);
        break;
      default:
        showScreen(go as ViewId);
    }
  });
}

document.querySelector<HTMLButtonElement>("#gc-menu-btn")!.addEventListener("click", showMenu);
document
  .querySelector<HTMLButtonElement>("#gc-account-btn")!
  .addEventListener("click", () => showScreen("account"));
document
  .querySelector<HTMLButtonElement>("#gc-settings-manage")!
  .addEventListener("click", () => showScreen("account"));
document.querySelector<HTMLButtonElement>("#gc-enter")!.addEventListener("click", (e) => {
  e.stopPropagation();
  enterShell();
});
splashEl.addEventListener("click", enterShell);

// Footer "Send feedback" — available across the client; gathers a lightweight
// context from the live app state when opened.
document
  .querySelector<HTMLButtonElement>("#footer-feedback")!
  .addEventListener("click", () => {
    openFeedbackModal({
      auth,
      context: () => ({
        view: currentView,
        userId: session?.userId ?? null,
        email: session?.email ?? null,
        selectedFaction: currentFaction,
      }),
    });
  });

// Static content — mount once at boot (no session/profile needed).
mountCardViewer(viewerEl);
mountRules(rulesEl);
mountLore(loreEl);

// Boot: restore any existing session, then render signup/starter accordingly and
// show the splash (or skip straight to the menu if already entered this session).
void (async () => {
  session = await auth.getSession().catch(() => null);
  const profile = session ? await auth.getProfile(session).catch(() => null) : null;
  // Retry rewards that failed to save in a previous session (best-effort).
  if (session !== null) {
    await syncPendingRewards(auth, session, getPendingStore()).catch(() => null);
  }
  await renderSignup();
  mountStarter(profile?.selected_faction ?? null);

  let entered = false;
  try {
    entered = sessionStorage.getItem(ENTERED_KEY) === "1";
  } catch {
    entered = false;
  }
  if (entered) enterShell();
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
