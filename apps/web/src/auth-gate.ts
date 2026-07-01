/**
 * Full-screen Euphoria auth gate + the session-check state helper. The playable
 * beta client is login-gated: none of the game screens (splash, menu, match,
 * deck editor, rewards, collection, settings) mount until an authenticated
 * session is confirmed. It uses the SAME `Auth` backend as the rest of the app
 * (Supabase when VITE_SUPABASE_* are set, else the localStorage demo) — there is
 * no second auth system here; it only drives auth.signIn / auth.signUp and hands
 * the resulting session back through `onAuthed`.
 */
import { isValidEmail } from "@euphoria/core/signup";
import type { Auth, AuthSession } from "@euphoria/core/auth";

/** Supabase's default minimum password length. */
export const GATE_MIN_PASSWORD_LENGTH = 6;

/** How long the initial session check may run before we fall back to the gate. */
export const AUTH_CHECK_TIMEOUT_MS = 8000;

/** Discriminated result of a session check — never "still checking forever". */
export type SessionCheck<T> =
  | { readonly state: "loggedIn"; readonly session: T }
  | { readonly state: "loggedOut" }
  | { readonly state: "error"; readonly error: unknown };

/**
 * Resolve the auth session with a hard timeout so the client can NEVER hang on
 * "Verifying access…". A resolved session → loggedIn; null → loggedOut; a thrown
 * error OR exceeding `timeoutMs` → error (caller shows the gate + a retry).
 * Pure (takes the getter + timeout) so it's unit-testable without a bundler.
 */
export async function checkSession<T>(
  getSession: () => Promise<T | null>,
  timeoutMs: number,
): Promise<SessionCheck<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = await Promise.race([
      getSession(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("auth-timeout")), timeoutMs);
      }),
    ]);
    return session === null
      ? { state: "loggedOut" }
      : { state: "loggedIn", session };
  } catch (error) {
    return { state: "error", error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface AuthGateOptions {
  /** The active auth backend (Supabase when configured, else localStorage demo). */
  readonly auth: Auth;
  /** Called once a real session is established; the caller reveals the beta. */
  readonly onAuthed: (session: AuthSession) => void;
  /** Optional banner (e.g. after a failed/timed-out session check). */
  readonly notice?: string;
  /** When set, renders a Retry button that re-runs the session check. */
  readonly onRetry?: () => void;
}

function note(isRemote: boolean): string {
  return isRemote
    ? "Beta accounts use email + password. Email confirmation is off, so you can start playing right away."
    : "Local preview mode — Supabase isn't configured, so accounts are kept on this device only.";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Static "verifying session" card — shown while the initial check runs. */
export function authGateLoadingMarkup(): string {
  return `
    <div class="gc-gate__card gc-gate__card--loading">
      <span class="gc-gate__spinner" aria-hidden="true"></span>
      <p class="gc-gate__verifying">Verifying access…</p>
    </div>
  `;
}

/**
 * Render the sign-in / create-account card into `root` and wire it to the auth
 * backend. Distinct Sign In and Create Account actions (with clear error copy)
 * both resolve to a session → `onAuthed`.
 */
export function mountAuthGate(
  root: HTMLElement,
  { auth, onAuthed, notice, onRetry }: AuthGateOptions,
): void {
  root.innerHTML = `
    <div class="gc-gate__card">
      <p class="gc-gate__eyebrow">Euphoria TCG · Beta</p>
      <h1 class="gc-gate__title">EUPHORIA</h1>
      <p class="gc-gate__lead">Sign in to enter the beta.</p>

      ${
        notice !== undefined
          ? `<p class="gc-gate__notice" role="alert">${escapeHtml(notice)}</p>`
          : ""
      }

      <form class="gc-gate__form" novalidate>
        <label class="gc-gate__label" for="gate-email">Email</label>
        <input id="gate-email" class="gc-gate__input" type="email" name="email"
          autocomplete="email" placeholder="you@example.com" />

        <label class="gc-gate__label" for="gate-password">Password</label>
        <input id="gate-password" class="gc-gate__input" type="password" name="password"
          autocomplete="current-password" placeholder="At least ${GATE_MIN_PASSWORD_LENGTH} characters" />

        <p class="gc-gate__error" role="alert" aria-live="polite" hidden></p>

        <div class="gc-gate__actions">
          <button type="submit" id="gate-signin" class="gc-gate__btn gc-gate__btn--primary">Sign In</button>
          <button type="button" id="gate-create" class="gc-gate__btn">Create Account</button>
        </div>
        ${
          onRetry !== undefined
            ? `<button type="button" id="gate-retry" class="gc-gate__retry">Retry access check</button>`
            : ""
        }
      </form>

      <p class="gc-gate__note">${note(auth.isRemote)}</p>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>(".gc-gate__form")!;
  const emailInput = root.querySelector<HTMLInputElement>("#gate-email")!;
  const passwordInput = root.querySelector<HTMLInputElement>("#gate-password")!;
  const signInBtn = root.querySelector<HTMLButtonElement>("#gate-signin")!;
  const createBtn = root.querySelector<HTMLButtonElement>("#gate-create")!;
  const errorEl = root.querySelector<HTMLParagraphElement>(".gc-gate__error")!;

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
  function clearError(): void {
    errorEl.hidden = true;
  }
  function setBusy(on: boolean): void {
    signInBtn.disabled = on;
    createBtn.disabled = on;
    signInBtn.textContent = on ? "Verifying…" : "Sign In";
  }

  emailInput.addEventListener("input", clearError);
  passwordInput.addEventListener("input", clearError);

  /** Validate the two fields, returning credentials or null (with an error shown). */
  function credentials(): { email: string; password: string } | null {
    const email = emailInput.value;
    const password = passwordInput.value;
    if (!isValidEmail(email)) {
      showError("Please enter a valid email address.");
      emailInput.focus();
      return null;
    }
    if (password.length < GATE_MIN_PASSWORD_LENGTH) {
      showError(`Password must be at least ${GATE_MIN_PASSWORD_LENGTH} characters.`);
      passwordInput.focus();
      return null;
    }
    return { email, password };
  }

  function run(
    action: (email: string, password: string) => Promise<AuthSession>,
    fallback: string,
  ): void {
    const creds = credentials();
    if (creds === null) return;
    clearError();
    setBusy(true);
    void action(creds.email, creds.password)
      .then((session) => onAuthed(session))
      .catch((err: unknown) => {
        showError(err instanceof Error && err.message ? err.message : fallback);
      })
      .finally(() => setBusy(false));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(
      (email, password) => auth.signIn(email, password),
      "Couldn't sign in. Check your details, or create an account.",
    );
  });

  createBtn.addEventListener("click", () => {
    run(
      (email, password) => auth.signUp(email, password),
      "Couldn't create an account. It may already exist — try Sign In.",
    );
  });

  if (onRetry !== undefined) {
    root
      .querySelector<HTMLButtonElement>("#gate-retry")!
      .addEventListener("click", onRetry);
  }

  emailInput.focus();
}
