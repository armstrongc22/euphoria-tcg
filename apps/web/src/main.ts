/**
 * Game-client shell entry point — a SINGLE-active-screen client.
 *
 * Exactly one major screen is mounted at a time into #game-screen-root; changing
 * screens clears the root (unmounting the previous screen's DOM) and mounts only
 * the new one. Nothing is pre-mounted and screens never stack: there is no
 * reliance on the `hidden` attribute (which CSS `display:flex` would defeat).
 *
 * Flow: auth check → (loggedOut) Auth Gate | (loggedIn) Splash → Main Menu →
 * one of Match / Deck Editor / Collection / Rewards / Settings → Back to Menu.
 *
 * The beta is login-gated: no game screen mounts until a session is confirmed,
 * and the session check has a hard timeout so it can never hang on "Verifying
 * access…". This is a UI-shell/architecture change only — the battle engine,
 * reward logic, deck validation, auth backend, and Supabase persistence are
 * unchanged; each existing view mount function is reused verbatim.
 */
import "./styles.css";
import "./game-shell.css";
import "./match-arena.css";
import "./duel.css";
import { mountAccount } from "./account-view";
import { mountDuel } from "./duel-view";
import { parseInviteCode } from "@euphoria/core/pvp";
import { createAuth, type AuthSession } from "@euphoria/core/auth";
import { cards } from "@euphoria/core/cards";
import { renderControls } from "./controls";
import { createCardDetail } from "./detail";
import { DEFAULT_FILTERS, filterCards, type CardFilters } from "@euphoria/core/filters";
import { renderGrid } from "./grid";
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
import {
  mountAuthGate,
  authGateLoadingMarkup,
  checkSession,
  AUTH_CHECK_TIMEOUT_MS,
} from "./auth-gate";
import type { StarterFaction } from "@euphoria/core/starter";

const BUILD_STAMP: string = import.meta.env.VITE_BUILD_STAMP ?? "dev";
(window as Window & { __EUPHORIA_BUILD__?: string }).__EUPHORIA_BUILD__ = BUILD_STAMP;
setBuildStamp(BUILD_STAMP);
installDiagnostics();

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app mount point missing from index.html");

/** Every top-level screen. Only one is ever mounted at a time. */
type ScreenId =
  | "auth"
  | "splash"
  | "menu"
  | "match"
  | "duel"
  | "rewards"
  | "deck"
  | "collection"
  | "starter"
  | "rules"
  | "lore"
  | "settings";

const SCREEN_TITLES: Record<ScreenId, string> = {
  auth: "Euphoria",
  splash: "Euphoria",
  menu: "Main Menu",
  match: "Match Arena",
  duel: "1v1 Duel",
  rewards: "Rewards & Account",
  deck: "Deck Editor",
  collection: "Collection",
  starter: "Choose Your Faction",
  rules: "Rules",
  lore: "Lore",
  settings: "Settings",
};

const MAP_URL = `${import.meta.env.BASE_URL.replace(/beta\/$/, "")}map`;
const ENTERED_KEY = "euphoria_beta_entered";

const ORBS: ReadonlyArray<{ color: string }> = [
  { color: "var(--f-monk)" },
  { color: "var(--f-dwarf)" },
  { color: "var(--f-surfer)" },
  { color: "var(--f-sonic)" },
  { color: "var(--f-shaman)" },
  { color: "var(--f-human)" },
  { color: "var(--f-neutral)" },
  { color: "var(--f-criminal)" },
];

// Persistent shell chrome (HUD + one screen root + footer). Screens render into
// #game-screen-root; the HUD is hidden on the auth/splash screens via CSS.
app.innerHTML = `
  <div class="gc" data-screen="auth">
    <header class="gc-hud" id="gc-hud">
      <button type="button" class="gc-hud__btn" id="gc-menu-btn" aria-label="Main menu">☰ Menu</button>
      <span class="gc-hud__title" id="gc-screen-title">Euphoria</span>
      <button type="button" class="gc-hud__btn" id="gc-account-btn">Account</button>
    </header>
    <main class="gc-screen-root" id="game-screen-root"></main>
    <footer class="gc-foot">
      Euphoria TCG · beta ·
      <button type="button" id="build-stamp" class="site-footer__stamp" title="Build version">build ${BUILD_STAMP}</button>
      · <button type="button" id="footer-feedback" class="gc-foot__link">Send feedback</button>
    </footer>
  </div>
`;

const gc = document.querySelector<HTMLElement>(".gc")!;
const root = document.querySelector<HTMLElement>("#game-screen-root")!;
const hudTitle = document.querySelector<HTMLElement>("#gc-screen-title")!;

// ---- App state -----------------------------------------------------------

const auth = createAuth();
type AuthState = "checking" | "loggedOut" | "loggedIn" | "error";
let authState: AuthState = "checking";
let session: AuthSession | null = null;
let currentFaction: StarterFaction | null = null;
// The faction a pending match should launch with (set before showing "match").
let playFaction: StarterFaction | null = null;
// An invite code from the URL (/beta/?invite=CODE). Consumed once the user is
// logged in (the Auth Gate shows first if they're signed out), then cleared.
let pendingInvite: string | null =
  typeof window !== "undefined" ? parseInviteCode(window.location) : null;
// For the footer feedback context.
let currentView: ScreenId = "auth";

// ---- Hidden debug reveal (unchanged) -------------------------------------
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

// ---- Utilities -----------------------------------------------------------

function scrollTop(): void {
  try {
    window.scrollTo(0, 0);
  } catch {
    /* no scroll in test env */
  }
}

function enteredThisSession(): boolean {
  try {
    return sessionStorage.getItem(ENTERED_KEY) === "1";
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function logAuth(message: string, err?: unknown): void {
  // Debug-safe: surfaces in the console + opt-in mobile diagnostics without
  // throwing. Helps diagnose a stuck/failed session check.
  try {
    console.warn(`[euphoria] ${message}`, err ?? "");
  } catch {
    /* console unavailable */
  }
}

// ---- Single active-screen renderer ---------------------------------------

/**
 * Mount exactly one screen into #game-screen-root, clearing (unmounting) whatever
 * was there. No screen is ever left behind; nothing is pre-rendered.
 */
function renderActiveScreen(
  screen: ScreenId,
  opts?: { readonly notice?: string },
): void {
  currentView = screen;
  gc.dataset.screen = screen;
  hudTitle.textContent = SCREEN_TITLES[screen];
  root.replaceChildren();

  switch (screen) {
    case "auth": {
      const gate = document.createElement("section");
      gate.className = "gc-gate";
      root.append(gate);
      mountAuthGate(gate, {
        auth,
        onAuthed,
        notice: opts?.notice,
        onRetry: opts?.notice !== undefined ? () => void checkAuth() : undefined,
      });
      break;
    }
    case "splash":
      root.append(renderSplash());
      break;
    case "menu":
      root.append(renderMenu());
      void refreshMenuStatus();
      break;
    case "match":
      // Match Arena: the interactive board (via account-view autoPlay). autoPlay
      // must equal the profile faction for the board to launch.
      void mountAccount(root, accountOptions(playFaction ?? currentFaction ?? undefined));
      break;
    case "duel": {
      // 1v1 private-invite lobby. Consumes a pending invite (from the URL) once.
      const invite = pendingInvite;
      pendingInvite = null;
      if (session !== null) {
        mountDuel(root, {
          auth,
          session,
          base: import.meta.env.BASE_URL,
          pool: cards,
          faction: currentFaction,
          pendingInvite: invite,
          onExit: () => renderActiveScreen("menu"),
        });
      } else {
        renderActiveScreen("menu");
      }
      break;
    }
    case "rewards":
      // The account hub: stats, rewards, owned cards, account + sign out.
      void mountAccount(root, accountOptions(undefined));
      break;
    case "starter":
      mountStarter();
      break;
    case "deck":
      void mountDeckBuilder(root, {
        auth,
        pool: cards,
        base: import.meta.env.BASE_URL,
        onSaved: () => {
          /* saved deck reflects on the account hub / next match; nothing to refresh here */
        },
        onPlayMatch: (faction) => {
          playFaction = faction;
          renderActiveScreen("match");
        },
      });
      break;
    case "collection":
      mountCardViewer(root);
      break;
    case "rules":
      mountRules(root);
      break;
    case "lore":
      mountLore(root);
      break;
    case "settings":
      root.append(renderSettings());
      break;
  }
  scrollTop();
}

function accountOptions(autoPlay: StarterFaction | undefined) {
  return {
    auth,
    pool: cards,
    base: import.meta.env.BASE_URL,
    autoPlay,
    onNavigate: (tab: "starter" | "deckbuilder") =>
      renderActiveScreen(tab === "deckbuilder" ? "deck" : "starter"),
    onSignOut,
  };
}

function mountStarter(): void {
  mountStarterDecks(root, cards, {
    initialFaction: currentFaction,
    currentFaction,
    onViewRules: () => renderActiveScreen("rules"),
    onPlayMatch: (faction) => {
      playFaction = faction;
      renderActiveScreen("match");
    },
    onChoose: (faction, { resetProgression }) => {
      void (async () => {
        const s = session ?? (await auth.getSession().catch(() => null));
        if (s !== null) {
          if (resetProgression) {
            await resetAllProgression(auth, s, {
              recovery: getRecoveryStore(),
              pending: getPendingStore(),
            });
          }
          await auth.saveFaction(s, faction).catch(() => {});
          currentFaction = faction;
        }
        renderActiveScreen("menu");
      })();
    },
  });
}

// ---- Screen builders (splash / menu / settings) --------------------------

function renderSplash(): HTMLElement {
  const s = document.createElement("section");
  s.className = "gc-splash";
  s.innerHTML = `
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
  `;
  s.addEventListener("click", enterFromSplash);
  s.querySelector<HTMLButtonElement>("#gc-enter")!.addEventListener("click", (e) => {
    e.stopPropagation();
    enterFromSplash();
  });
  return s;
}

function enterFromSplash(): void {
  try {
    sessionStorage.setItem(ENTERED_KEY, "1");
  } catch {
    /* private mode — splash just shows each load */
  }
  renderActiveScreen("menu");
}

function renderMenu(): HTMLElement {
  const s = document.createElement("section");
  s.className = "gc-menu";
  s.innerHTML = `
    <h1 class="gc-title">EUPHORIA</h1>
    <div class="gc-status" id="gc-status"></div>
    <nav class="gc-menu__actions" aria-label="Game menu">
      <button type="button" class="gc-action gc-action--primary" data-go="play">
        <span class="gc-action__label">▶ Start Match</span>
        <span class="gc-action__hint">Battle the AI with your deck</span>
      </button>
      <button type="button" class="gc-action" data-go="duel">
        <span class="gc-action__label">1v1 Duel</span>
        <span class="gc-action__hint">Invite a friend to a private match</span>
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
      <button type="button" class="gc-link" data-go="rules">Rules</button>
      <button type="button" class="gc-link" data-go="lore">Lore</button>
    </div>
  `;
  for (const btn of s.querySelectorAll<HTMLButtonElement>("[data-go]")) {
    btn.addEventListener("click", () => onMenuGo(btn.dataset.go!));
  }
  return s;
}

function onMenuGo(go: string): void {
  switch (go) {
    case "play":
      if (currentFaction !== null) {
        playFaction = currentFaction;
        renderActiveScreen("match");
      } else {
        renderActiveScreen("starter");
      }
      break;
    case "duel":
      renderActiveScreen("duel");
      break;
    case "deckbuilder":
      renderActiveScreen("deck");
      break;
    case "viewer":
      renderActiveScreen("collection");
      break;
    case "rewards":
      renderActiveScreen("rewards");
      break;
    case "map":
      window.location.assign(MAP_URL);
      break;
    case "settings":
      renderActiveScreen("settings");
      break;
    case "rules":
      renderActiveScreen("rules");
      break;
    case "lore":
      renderActiveScreen("lore");
      break;
  }
}

/** Fill the menu status chips (sign-in, faction, win/reward progress). */
async function refreshMenuStatus(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>("#gc-status");
  if (statusEl === null) return;
  const chips: string[] = [];
  chips.push(
    session !== null
      ? `<span class="gc-status__chip gc-status__chip--accent">◆ ${escapeHtml(session.email ?? "Player")}</span>`
      : `<span class="gc-status__chip gc-status__chip--muted">Not signed in</span>`,
  );
  chips.push(
    `<span class="gc-status__chip">${currentFaction !== null ? `Faction: ${escapeHtml(currentFaction)}` : "No deck selected"}</span>`,
  );
  statusEl.innerHTML = chips.join("");

  if (session !== null) {
    const stats = await auth.getMatchStats(session).catch(() => null);
    // Only append if the menu is still on screen (user may have navigated away).
    if (stats !== null && currentView === "menu") {
      const el = document.querySelector<HTMLElement>("#gc-status");
      if (el !== null) {
        const chip = document.createElement("span");
        chip.className = "gc-status__chip";
        chip.textContent = `${stats.wins} wins · next reward at ${nextRewardMilestone(stats.wins)}`;
        el.append(chip);
      }
    }
  }
}

function renderSettings(): HTMLElement {
  const s = document.createElement("section");
  s.className = "gc-settings";
  s.innerHTML = `
    <section class="gc-panel">
      <h2 class="gc-panel__title">Account</h2>
      <p class="gc-panel__line" id="gc-settings-account">${
        session !== null
          ? `Signed in as ${escapeHtml(session.email ?? "player")}`
          : "Not signed in."
      }</p>
      <button type="button" class="gc-btn" id="gc-settings-manage">Manage account &amp; rewards</button>
    </section>

    <!-- Future-ready soundtrack area. No third-party player is loaded; this is a
         placeholder wired for a future original/licensed Euphoria OST. -->
    <section class="gc-panel gc-panel--ost" aria-labelledby="gc-ost-title">
      <div class="gc-panel__head">
        <h2 class="gc-panel__title" id="gc-ost-title">Music / OST</h2>
        <span class="gc-badge">Coming soon</span>
      </div>
      <p class="gc-panel__line">An original Euphoria soundtrack is planned for a future update.</p>
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
  `;
  s.querySelector<HTMLButtonElement>("#gc-settings-manage")!.addEventListener("click", () =>
    renderActiveScreen("rewards"),
  );
  return s;
}

// ---- Auth flow -----------------------------------------------------------

/** Show the "verifying access" loading card (bounded by the check timeout). */
function showChecking(): void {
  currentView = "auth";
  gc.dataset.screen = "auth";
  const gate = document.createElement("section");
  gate.className = "gc-gate";
  gate.innerHTML = authGateLoadingMarkup();
  root.replaceChildren(gate);
}

/** Initial (and retry) session check — resolves to gate or beta, never hangs. */
async function checkAuth(): Promise<void> {
  authState = "checking";
  showChecking();
  const result = await checkSession(() => auth.getSession(), AUTH_CHECK_TIMEOUT_MS);
  if (result.state === "loggedIn") {
    await onLoggedIn(result.session, false);
  } else if (result.state === "loggedOut") {
    authState = "loggedOut";
    renderActiveScreen("auth");
  } else {
    authState = "error";
    logAuth("session check failed or timed out", result.error);
    renderActiveScreen("auth", {
      notice: "We couldn't verify your session. Sign in below, or retry.",
    });
  }
}

/** A confirmed session: load profile, retry pending rewards, reveal the beta. */
async function onLoggedIn(next: AuthSession, fresh: boolean): Promise<void> {
  session = next;
  authState = "loggedIn";
  const profile = await auth.getProfile(next).catch(() => null);
  currentFaction = profile?.selected_faction ?? null;
  await syncPendingRewards(auth, next, getPendingStore()).catch(() => null);
  // An invite link takes priority: go straight to the duel lobby to auto-join.
  if (pendingInvite !== null) {
    renderActiveScreen("duel");
    return;
  }
  // Fresh logins always see the splash; a restored session respects "entered".
  renderActiveScreen(!fresh && enteredThisSession() ? "menu" : "splash");
}

/** Auth gate success. */
function onAuthed(next: AuthSession): void {
  void onLoggedIn(next, true);
}

/** Sign out for real (persists across reload), then return to the gate. */
function onSignOut(): void {
  void (async () => {
    await auth.signOut().catch(() => {});
    session = null;
    currentFaction = null;
    playFaction = null;
    authState = "loggedOut";
    renderActiveScreen("auth");
  })();
}

// ---- Persistent chrome wiring --------------------------------------------

document.querySelector<HTMLButtonElement>("#gc-menu-btn")!.addEventListener("click", () => {
  if (authState === "loggedIn") renderActiveScreen("menu");
});
document.querySelector<HTMLButtonElement>("#gc-account-btn")!.addEventListener("click", () => {
  if (authState === "loggedIn") renderActiveScreen("rewards");
});
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

// Boot: run the login-gated session check. Nothing game-facing mounts first.
void checkAuth();

/** Mounts the card viewer (filters + grid + detail modal) into a container. */
function mountCardViewer(container: HTMLElement): void {
  container.innerHTML = `
    <section id="controls" class="controls" aria-label="Filters"></section>
    <p id="count" class="result-count" role="status"></p>
    <main id="grid" class="card-grid" aria-label="Cards"></main>
  `;

  const controlsEl = container.querySelector<HTMLElement>("#controls")!;
  const countEl = container.querySelector<HTMLElement>("#count")!;
  const gridEl = container.querySelector<HTMLElement>("#grid")!;

  const detail = createCardDetail(import.meta.env.BASE_URL);
  // Append the detail modal INTO the screen root so it's cleared when the screen
  // changes (no orphaned modals accumulate on document.body).
  container.append(detail.element);

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
