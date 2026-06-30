import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getSupabaseClient } from "@euphoria/core/supabase-client";
import { isSupabaseConfigured } from "@euphoria/core/supabase-config";
import {
  isValidEmail,
  normalizeEmail,
  submitInterest,
  type InterestInserter,
  type SubmitStatus,
} from "./waitlist";

interface InterestFormProps {
  /** Which page/intent this form represents (stored on the row). */
  readonly source: string;
  /** Update categories the signup opts into. */
  readonly interests?: readonly string[];
  readonly submitLabel?: string;
}

const CONSENT_LABEL = "Yes — email me Euphoria manga & Kickstarter updates.";
const PRIVACY =
  "We’ll only email you about Euphoria’s manga, Kickstarter, and launch " +
  "updates. No spam, unsubscribe anytime, and we never sell your data.";
const SUCCESS =
  "You’re on the list — we’ll email you the moment the Kickstarter campaign " +
  "goes live.";

type FormState = SubmitStatus | "idle" | "submitting" | "invalid";

/**
 * Reusable email/interest capture form. Drop it on any page with a `source`
 * prop (manga / shop / blog / kickstarter). Writes through the shared
 * @euphoria/core Supabase client; when Supabase isn't configured it degrades to
 * an honest blog-follow fallback rather than a dead form. Phase 1 anti-abuse:
 * honeypot + client email validation + required consent (also enforced by RLS).
 */
export function InterestForm({
  source,
  interests = ["kickstarter", "manga", "launch"],
  submitLabel = "Notify me",
}: InterestFormProps) {
  const emailId = useId();
  const consentId = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<FormState>("idle");

  // No backend configured (e.g. local dev without env) → honest fallback.
  if (!isSupabaseConfigured()) {
    return (
      <p className="eu-signup__fallback">
        Signups open with the campaign. For now,{" "}
        <Link to="/blog">follow development on the blog →</Link>
      </p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Honeypot: a real user never fills this. Pretend success, write nothing.
    if (honeypot.trim() !== "") {
      setState("ok");
      return;
    }
    if (!isValidEmail(email)) {
      setState("invalid");
      return;
    }
    setState("submitting");
    const client = getSupabaseClient();
    const insert: InterestInserter | null =
      client === null ? null : (table, row) => client.from(table).insert(row);
    const result = await submitInterest(insert, {
      email: normalizeEmail(email),
      source,
      interests: [...interests],
      consent,
      referrer:
        typeof document !== "undefined" && document.referrer.length > 0
          ? document.referrer
          : null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setState(result);
  }

  if (state === "ok" || state === "duplicate") {
    return (
      <p className="eu-signup__success" role="status">
        {state === "duplicate"
          ? "You’re already on the list — we’ll be in touch."
          : SUCCESS}
      </p>
    );
  }

  const busy = state === "submitting";
  const canSubmit = consent && email.trim() !== "" && !busy;

  return (
    <form className="eu-signup" onSubmit={onSubmit} noValidate>
      <div className="eu-signup__row">
        <label className="eu-signup__label" htmlFor={emailId}>
          Email address
        </label>
        <input
          id={emailId}
          className="eu-signup__input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
          required
        />
      </div>

      {/* Honeypot — visually hidden, off-tab; bots fill it, humans don't. */}
      <div className="eu-signup__hp" aria-hidden="true">
        <label htmlFor={`${emailId}-company`}>Company</label>
        <input
          id={`${emailId}-company`}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      <label className="eu-signup__consent" htmlFor={consentId}>
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{CONSENT_LABEL}</span>
      </label>

      <button
        type="submit"
        className="eu-btn eu-btn--red"
        disabled={!canSubmit}
      >
        {busy ? "Joining…" : submitLabel}
      </button>

      <p className="eu-signup__privacy">{PRIVACY}</p>

      <p className="eu-signup__status" role="status" aria-live="polite">
        {state === "invalid" && "Please enter a valid email address."}
        {state === "error" &&
          "Something went wrong — please try again in a moment."}
      </p>
    </form>
  );
}
