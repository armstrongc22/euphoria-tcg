/**
 * Beta feedback / bug report modal (Features A, B, E, F). Pure DOM. A small
 * overlay with a type select, a message box, an optional contact email (shown
 * only when signed out), and an "Include debug info" checkbox. On submit it
 * assembles the lightweight context (build/view/user-agent/mobile + whatever the
 * caller supplies) via {@link buildFeedbackInsert} and persists it through the
 * injected `Auth` backend.
 *
 * Failure never loses the report: it is parked in the localStorage pending queue
 * (Feature F) and the typed message is preserved on screen with the exact error.
 *
 * The base context (build, user agent, mobile, debug events) is auto-attached
 * here so each entry point only needs to supply its situational pieces (view,
 * user, faction, and any match/reward/onboarding summary).
 */
import type { Auth } from "./auth";
import type { KeyValueStore } from "./signup";
import { getBuildStamp, readDebugLog } from "@euphoria/core/debug-log";
import { isLikelyMobile } from "./debug-flags";
import {
  FEEDBACK_TYPES,
  buildFeedbackInsert,
  getFeedbackStore,
  isValidFeedback,
  savePendingFeedback,
  type FeedbackInput,
  type FeedbackType,
} from "./feedback";

/**
 * The situational context an entry point supplies. Everything is optional — the
 * modal fills build/user-agent/mobile/debug-events itself. Keep these compact
 * (never full deck or match state).
 */
export interface FeedbackContext {
  /** Current top-level view name (e.g. "account", "live-match"). */
  readonly view?: string;
  /** Signed-in user id, or null when anonymous. */
  readonly userId?: string | null;
  /** Signed-in user's email, attached automatically when present. */
  readonly email?: string | null;
  /** The player's selected starter faction, if any. */
  readonly selectedFaction?: string | null;
  /** Active deck mode (e.g. "starter" / "custom"). */
  readonly deckMode?: string;
  /** Onboarding step identifier, if mid-onboarding. */
  readonly onboardingStep?: string;
  /** Compact live-match summary (turn/phase/lives/counts), when in a match. */
  readonly match?: Record<string, unknown>;
  /** Compact reward/owned summary, when relevant. */
  readonly reward?: Record<string, unknown>;
}

export interface OpenFeedbackOptions {
  /** The active auth backend (persists the report). */
  readonly auth: Auth;
  /**
   * Gathers the situational context when the modal opens. A function so the
   * snapshot is fresh (a live match's turn/phase may have advanced).
   */
  readonly context: () => FeedbackContext;
  /** Pre-selected feedback type (e.g. "bug" from a "Report issue" button). */
  readonly defaultType?: FeedbackType;
  /** Where to mount the overlay (defaults to document.body). */
  readonly host?: HTMLElement;
  /** localStorage for the pending-fallback queue (defaults to getFeedbackStore()). */
  readonly store?: KeyValueStore | null;
  /** Called after the modal closes (sent or cancelled). */
  readonly onClose?: () => void;
}

/** Handle returned by {@link openFeedbackModal}. */
export interface FeedbackModalHandle {
  readonly element: HTMLElement;
  readonly close: () => void;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Opens the feedback modal and returns a handle. Idempotent per call (each call
 * mounts a fresh overlay); callers typically wire it to a button click.
 */
export function openFeedbackModal(options: OpenFeedbackOptions): FeedbackModalHandle {
  const host = options.host ?? document.body;
  const store = options.store !== undefined ? options.store : getFeedbackStore();
  const ctx = options.context();
  const signedIn = ctx.userId != null && ctx.userId !== "";

  const overlay = document.createElement("div");
  overlay.className = "feedback-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Send feedback");

  const typeOptions = FEEDBACK_TYPES.map(
    (t) =>
      `<option value="${t.value}"${
        options.defaultType === t.value ? " selected" : ""
      }>${escapeHtml(t.label)}</option>`,
  ).join("");

  overlay.innerHTML = `
    <div class="feedback-modal__backdrop" data-action="cancel"></div>
    <form class="feedback-modal__card" novalidate>
      <div class="feedback-modal__head">
        <h2 class="feedback-modal__title">Send feedback</h2>
        <button type="button" class="feedback-modal__close" data-action="cancel"
          aria-label="Close">×</button>
      </div>
      <p class="feedback-modal__lead">
        Found a bug or have a suggestion? Tell us what happened — it goes straight
        to the team.
      </p>

      <label class="feedback-modal__label" for="feedback-type">Type</label>
      <select id="feedback-type" class="feedback-modal__select" name="type">
        ${typeOptions}
      </select>

      <label class="feedback-modal__label" for="feedback-message">Message</label>
      <textarea id="feedback-message" class="feedback-modal__textarea" name="message"
        rows="5" placeholder="What happened? What did you expect?"></textarea>

      ${
        signedIn
          ? ""
          : `
      <label class="feedback-modal__label" for="feedback-email">Email (optional)</label>
      <input id="feedback-email" class="feedback-modal__input" type="email"
        name="email" autocomplete="email" placeholder="So we can follow up" />`
      }

      <label class="feedback-modal__check">
        <input type="checkbox" name="includeDebug" />
        Include debug info (recent diagnostic events)
      </label>

      <p class="feedback-modal__error" role="alert" aria-live="polite" hidden></p>
      <p class="feedback-modal__success" role="status" aria-live="polite" hidden></p>

      <div class="feedback-modal__actions">
        <button type="button" class="feedback-modal__btn feedback-modal__btn--ghost"
          data-action="cancel">Cancel</button>
        <button type="submit" class="feedback-modal__btn feedback-modal__btn--send">
          Send feedback
        </button>
      </div>
    </form>
  `;

  const form = overlay.querySelector<HTMLFormElement>(".feedback-modal__card")!;
  const typeSelect = overlay.querySelector<HTMLSelectElement>("#feedback-type")!;
  const messageInput =
    overlay.querySelector<HTMLTextAreaElement>("#feedback-message")!;
  const emailInput = overlay.querySelector<HTMLInputElement>("#feedback-email");
  const debugCheck =
    overlay.querySelector<HTMLInputElement>('input[name="includeDebug"]')!;
  const sendBtn = overlay.querySelector<HTMLButtonElement>(".feedback-modal__btn--send")!;
  const errorEl = overlay.querySelector<HTMLParagraphElement>(".feedback-modal__error")!;
  const successEl =
    overlay.querySelector<HTMLParagraphElement>(".feedback-modal__success")!;

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = false;
    successEl.hidden = true;
  }
  function clearError(): void {
    errorEl.hidden = true;
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  }

  for (const el of overlay.querySelectorAll<HTMLElement>('[data-action="cancel"]')) {
    el.addEventListener("click", close);
  }
  messageInput.addEventListener("input", clearError);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = messageInput.value;
    if (!isValidFeedback(message)) {
      showError("Please enter a message before sending.");
      messageInput.focus();
      return;
    }
    clearError();

    const includeDebug = debugCheck.checked;
    const input: FeedbackInput = {
      type: typeSelect.value as FeedbackType,
      message,
      userId: ctx.userId ?? null,
      email: signedIn ? (ctx.email ?? null) : (emailInput?.value ?? null),
      view: ctx.view ?? null,
      build: getBuildStamp(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      mobile: isLikelyMobile(),
      selectedFaction: ctx.selectedFaction ?? null,
      includeDebug,
      ...(ctx.deckMode !== undefined ? { deckMode: ctx.deckMode } : {}),
      ...(ctx.onboardingStep !== undefined
        ? { onboardingStep: ctx.onboardingStep }
        : {}),
      ...(ctx.match !== undefined ? { match: ctx.match } : {}),
      ...(ctx.reward !== undefined ? { reward: ctx.reward } : {}),
      ...(includeDebug ? { debugEvents: readDebugLog() } : {}),
    };
    const insert = buildFeedbackInsert(input);

    sendBtn.disabled = true;
    void options.auth
      .saveFeedback(insert)
      .then(() => {
        successEl.textContent = "Thanks — feedback sent.";
        successEl.hidden = false;
        // Brief acknowledgement, then close.
        setTimeout(close, 1200);
      })
      .catch((err: unknown) => {
        // Feature F: never discard. Park it locally and keep the typed message.
        const detail = err instanceof Error ? err.message : String(err);
        if (store !== null) savePendingFeedback(store, insert, detail);
        showError(
          store !== null
            ? `Couldn't send right now — saved locally to retry. (${detail})`
            : `Couldn't send: ${detail}`,
        );
        sendBtn.disabled = false;
      });
  });

  host.append(overlay);
  messageInput.focus();
  return { element: overlay, close };
}

/**
 * Creates a button that opens the feedback modal when clicked — the shared entry
 * point used by the footer, account page, live match, and debug panel.
 */
export function createFeedbackButton(
  label: string,
  options: OpenFeedbackOptions,
  className = "feedback-trigger",
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", () => openFeedbackModal(options));
  return btn;
}
