/**
 * Beta signup / start screen. Pure DOM. Validates the email, persists it via the
 * signup module (local/demo only — see signup.ts for the real-capture TODO), then
 * hands off to the starter-deck selection via `onContinue`.
 */
import {
  isValidEmail,
  loadSignup,
  recordSignup,
  type KeyValueStore,
} from "./signup";

export interface SignupViewOptions {
  /** Where signup state is persisted, or null when storage is unavailable. */
  readonly store: KeyValueStore | null;
  /** Called after a successful signup (or "continue") to advance the flow. */
  readonly onContinue: () => void;
}

const HEADLINE_COPY =
  "Choose your starter deck. Play games. Earn reward cards. Upgrade your faction over time.";
const LOCAL_NOTE =
  "Beta signup is local preview for now. Real email capture will be connected before launch.";

/**
 * Mounts the signup screen into `container`. Returns nothing; all behavior is
 * wired to the form. If the visitor has already signed up, it greets them and
 * offers a direct "Continue" button instead of forcing a re-entry.
 */
export function mountSignup(
  container: HTMLElement,
  options: SignupViewOptions,
): void {
  const { store, onContinue } = options;
  const existing = store ? loadSignup(store) : null;
  const returning = existing !== null && existing.email.length > 0;

  container.innerHTML = `
    <section class="signup">
      <div class="signup__card">
        <p class="signup__eyebrow">Euphoria TCG · Beta</p>
        <h2 class="signup__title">Join the Euphoria beta</h2>
        <p class="signup__lead">${HEADLINE_COPY}</p>

        <form class="signup__form" novalidate>
          <label class="signup__label" for="signup-email">Email address</label>
          <div class="signup__row">
            <input
              id="signup-email"
              class="signup__input"
              type="email"
              name="email"
              autocomplete="email"
              placeholder="you@example.com"
              aria-describedby="signup-note"
            />
            <button type="submit" class="signup__submit">
              ${returning ? "Continue" : "Get started"}
            </button>
          </div>
          <p class="signup__error" role="alert" aria-live="polite" hidden></p>
          ${
            returning
              ? `<p class="signup__welcome">Signed up as <strong>${escapeHtml(
                  existing!.email,
                )}</strong>. Continue to your starter deck below.</p>`
              : ""
          }
        </form>

        <p id="signup-note" class="signup__note">${LOCAL_NOTE}</p>
      </div>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>(".signup__form")!;
  const input = container.querySelector<HTMLInputElement>("#signup-email")!;
  const error = container.querySelector<HTMLParagraphElement>(".signup__error")!;

  if (returning) input.value = existing!.email;

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
  }

  function clearError(): void {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  }

  input.addEventListener("input", clearError);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input.value;

    if (!isValidEmail(email)) {
      showError("Please enter a valid email address.");
      input.focus();
      return;
    }

    clearError();
    // Local/demo persistence only — no network. See signup.ts TODO.
    if (store) {
      try {
        recordSignup(store, email);
      } catch {
        // Storage failure shouldn't block the flow; continue regardless.
      }
    }
    onContinue();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
