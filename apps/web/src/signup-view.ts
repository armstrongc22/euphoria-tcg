/**
 * Beta signup / start screen. Pure DOM. Collects an email + password and creates
 * (or signs into) a Euphoria account via the injected `Auth` backend, then hands
 * off to starter-deck selection through `onContinue`.
 *
 * The backend is either Supabase (real accounts) or the localStorage demo
 * fallback — this view doesn't care which; it only reads `auth.isRemote` to pick
 * the right helper copy. Email confirmation is OFF for the beta, so a successful
 * signup advances the user immediately.
 */
import { isValidEmail } from "@euphoria/core/signup";
import { signUpOrSignIn, type Auth, type AuthSession } from "./auth";

/** Supabase's default minimum password length. */
export const MIN_PASSWORD_LENGTH = 6;

export interface SignupViewOptions {
  /** The active auth backend (Supabase when configured, else localStorage demo). */
  readonly auth: Auth;
  /** Called once authenticated (or "continue") to advance the flow. */
  readonly onContinue: (session: AuthSession) => void;
}

const HEADLINE_COPY =
  "Create your account, choose your starter deck, play games, and earn reward cards to upgrade your faction over time.";

function helperNote(isRemote: boolean): string {
  return isRemote
    ? "Beta accounts use email + password. Email confirmation is off, so you can start playing right away."
    : "Local preview mode — Supabase isn't configured, so accounts are kept on this device only.";
}

/**
 * Mounts the signup screen into `container`. Async because it probes the auth
 * backend for an existing session: a returning, signed-in visitor gets a
 * "Continue" button instead of being forced to re-enter credentials.
 */
export async function mountSignup(
  container: HTMLElement,
  options: SignupViewOptions,
): Promise<void> {
  const { auth, onContinue } = options;
  const existing = await auth.getSession().catch(() => null);

  if (existing !== null) {
    renderReturning(container, auth, existing, onContinue);
    return;
  }

  renderForm(container, auth, onContinue);
}

/** Signed-in visitor: greet them and offer a direct continue. */
function renderReturning(
  container: HTMLElement,
  auth: Auth,
  session: AuthSession,
  onContinue: (session: AuthSession) => void,
): void {
  container.innerHTML = `
    <section class="signup">
      <div class="signup__card">
        <p class="signup__eyebrow">Euphoria TCG · Beta</p>
        <h2 class="signup__title">Welcome back</h2>
        <p class="signup__welcome">Signed in as <strong>${escapeHtml(
          session.email,
        )}</strong>.</p>
        <button type="button" class="signup__submit" data-action="continue">
          Continue to your starter deck
        </button>
        <p class="signup__note">${helperNote(auth.isRemote)}</p>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLButtonElement>('[data-action="continue"]')!
    .addEventListener("click", () => onContinue(session));
}

/** New / signed-out visitor: the email + password form. */
function renderForm(
  container: HTMLElement,
  auth: Auth,
  onContinue: (session: AuthSession) => void,
): void {
  container.innerHTML = `
    <section class="signup">
      <div class="signup__card">
        <p class="signup__eyebrow">Euphoria TCG · Beta</p>
        <h2 class="signup__title">Join the Euphoria beta</h2>
        <p class="signup__lead">${HEADLINE_COPY}</p>

        <form class="signup__form" novalidate>
          <label class="signup__label" for="signup-email">Email address</label>
          <input
            id="signup-email"
            class="signup__input"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@example.com"
            aria-describedby="signup-note"
          />

          <label class="signup__label" for="signup-password">Password</label>
          <input
            id="signup-password"
            class="signup__input"
            type="password"
            name="password"
            autocomplete="current-password"
            placeholder="At least ${MIN_PASSWORD_LENGTH} characters"
          />

          <button type="submit" class="signup__submit">Create account / Sign in</button>
          <p class="signup__error" role="alert" aria-live="polite" hidden></p>
        </form>

        <p id="signup-note" class="signup__note">${helperNote(auth.isRemote)}</p>
      </div>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>(".signup__form")!;
  const emailInput = container.querySelector<HTMLInputElement>("#signup-email")!;
  const passwordInput =
    container.querySelector<HTMLInputElement>("#signup-password")!;
  const submit = container.querySelector<HTMLButtonElement>(".signup__submit")!;
  const error = container.querySelector<HTMLParagraphElement>(".signup__error")!;

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }
  function clearError(): void {
    error.hidden = true;
  }

  emailInput.addEventListener("input", clearError);
  passwordInput.addEventListener("input", clearError);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!isValidEmail(email)) {
      showError("Please enter a valid email address.");
      emailInput.focus();
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      showError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      passwordInput.focus();
      return;
    }

    clearError();
    submit.disabled = true;
    void signUpOrSignIn(auth, email, password)
      .then((session) => onContinue(session))
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Something went wrong. Try again.";
        showError(message);
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
