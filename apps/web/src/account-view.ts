/**
 * Account view. Shows the signed-in user's email, their selected faction and
 * chosen starter deck, placeholders for beta progression and reward cards, and a
 * sign-out button.
 *
 * Split in two:
 *   - renderAccount(info, pool, onSignOut): a PURE DOM builder (no auth, no
 *     network) so the rendering can be unit-tested with jsdom.
 *   - mountAccount(container, opts): loads the session + profile from the Auth
 *     backend and renders into the container; handles the signed-out case.
 */
import type { Card } from "@euphoria/card-data/schema";
import type { Auth } from "./auth";
import { renderMatchResult } from "./match-view";
import { runTestMatch } from "./match";
import {
  deckCardCount,
  getRecipe,
  type StarterFaction,
} from "./starter";

/** Everything the account card needs, already resolved from the backend. */
export interface AccountInfo {
  readonly email: string;
  readonly faction: StarterFaction | null;
  /** True for a real Supabase account, false for the localStorage demo. */
  readonly isRemote: boolean;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function field(label: string, value: string, valueClass = ""): HTMLElement {
  const row = document.createElement("div");
  row.className = "account__field";
  row.innerHTML =
    `<dt class="account__label">${escapeHtml(label)}</dt>` +
    `<dd class="account__value ${valueClass}">${escapeHtml(value)}</dd>`;
  return row;
}

/**
 * Builds the account card. Pure DOM — pass a plain {@link AccountInfo}. The
 * starter-deck line is derived from the frozen recipe (./starter); recipes are
 * never regenerated here.
 */
export function renderAccount(
  info: AccountInfo,
  _pool: readonly Card[],
  onSignOut: () => void,
  /**
   * Optional: when provided AND a faction is chosen, render a "Play test match"
   * panel that calls back with the faction. Omitted in pure-render tests, so the
   * panel only appears where the caller can actually run a match.
   */
  onPlayMatch?: (faction: StarterFaction) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "account";

  const header = document.createElement("div");
  header.className = "account__header";
  header.innerHTML =
    `<p class="account__eyebrow">Euphoria TCG · Beta</p>` +
    `<h2 class="account__title">Your account</h2>` +
    `<p class="account__mode">${
      info.isRemote
        ? "Signed in to your Euphoria account."
        : "Local preview account (Supabase not configured)."
    }</p>`;
  section.append(header);

  const list = document.createElement("dl");
  list.className = "account__fields";
  list.append(field("Email", info.email || "—"));
  list.append(
    field("Selected faction", info.faction ?? "Not chosen yet"),
  );

  if (info.faction !== null) {
    const recipe = getRecipe(info.faction);
    list.append(
      field(
        "Starter deck",
        `${recipe.faction} Starter Deck · ${deckCardCount(recipe)} cards`,
      ),
    );
  } else {
    list.append(
      field("Starter deck", "Choose a deck on the Starter Decks tab"),
    );
  }
  section.append(list);

  if (info.faction !== null && onPlayMatch !== undefined) {
    const faction = info.faction;
    const match = document.createElement("section");
    match.className = "account__panel account__match";
    match.innerHTML =
      `<h3 class="account__panel-heading">Test match</h3>` +
      `<p class="account__panel-body">Run a quick local simulation with your ` +
      `${escapeHtml(faction)} starter deck against a random AI opponent. ` +
      `Beta demo — nothing is saved yet.</p>`;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "account__play";
    play.textContent = "Play test match";
    play.addEventListener("click", () => onPlayMatch(faction));
    match.append(play);
    section.append(match);
  }

  const progression = document.createElement("section");
  progression.className = "account__panel account__progression";
  progression.innerHTML =
    `<h3 class="account__panel-heading">Beta progression</h3>` +
    `<p class="account__panel-body">Progression tracking is coming soon. ` +
    `Play games to level up your faction during the beta.</p>` +
    `<div class="account__progress" role="img" aria-label="Beta progression placeholder">` +
    `<div class="account__progress-bar" style="width: 0%"></div></div>`;
  section.append(progression);

  const rewards = document.createElement("section");
  rewards.className = "account__panel account__rewards";
  rewards.innerHTML =
    `<h3 class="account__panel-heading">Reward cards</h3>` +
    `<p class="account__panel-body">Reward cards coming soon. ` +
    `You'll earn cards to customize and upgrade your starter deck over time.</p>`;
  section.append(rewards);

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "account__signout";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", onSignOut);
  section.append(signOut);

  return section;
}

/** A short signed-out prompt shown when nobody is authenticated. */
function renderSignedOut(): HTMLElement {
  const section = document.createElement("section");
  section.className = "account account--signed-out";
  section.innerHTML =
    `<h2 class="account__title">Your account</h2>` +
    `<p class="account__panel-body">You're not signed in. ` +
    `Head to the <strong>Signup / Start</strong> tab to create your account or sign in.</p>`;
  return section;
}

/** Options for {@link mountAccount}. */
export interface AccountOptions {
  readonly auth: Auth;
  readonly pool: readonly Card[];
  /** Called after the user signs out, so the app can return to signup. */
  readonly onSignOut: () => void;
}

/**
 * Loads the current session + profile and renders the account card into
 * `container`. Safe to call repeatedly (e.g. each time the tab is shown).
 */
export async function mountAccount(
  container: HTMLElement,
  options: AccountOptions,
): Promise<void> {
  const { auth, pool, onSignOut } = options;

  const session = await auth.getSession();
  if (session === null) {
    container.replaceChildren(renderSignedOut());
    return;
  }

  const profile = await auth.getProfile(session);
  const info: AccountInfo = {
    email: profile?.email ?? session.email,
    faction: profile?.selected_faction ?? null,
    isRemote: auth.isRemote,
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await auth.signOut();
    } finally {
      onSignOut();
    }
  };

  // The match runs entirely client-side: show its result in place of the
  // account card, with Play again (re-run) and Back to account (re-render).
  const showResult = (faction: StarterFaction): void => {
    const summary = runTestMatch({ faction, pool });
    container.replaceChildren(
      renderMatchResult(summary, {
        onPlayAgain: () => showResult(faction),
        onBack: showAccount,
      }),
    );
  };

  function showAccount(): void {
    container.replaceChildren(
      renderAccount(info, pool, handleSignOut, showResult),
    );
  }

  showAccount();
}
