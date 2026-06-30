/**
 * Pure interest-signup submission for the Euphoria Universe waitlist. No React
 * and no direct Supabase import — it takes an inserter function so it stays
 * trivially testable and decoupled from the SDK. Writes one row into
 * public.interest_signups (insert-only; see apps/site/README.md for the table +
 * RLS). A duplicate email (unique index → Postgres error 23505) is reported as
 * "duplicate", which the UI treats as a friendly success.
 */

export interface InterestRow {
  readonly email: string;
  /** Which page/intent the signup came from: manga | shop | blog | kickstarter | home. */
  readonly source: string;
  readonly interests: readonly string[];
  readonly consent: boolean;
  readonly referrer: string | null;
  readonly user_agent: string | null;
}

export type SubmitStatus = "ok" | "duplicate" | "error" | "unconfigured";

/** The single insert call we need — satisfied by `client.from(t).insert(row)`. */
export type InterestInserter = (
  table: string,
  row: InterestRow,
) => PromiseLike<{ error: { readonly code?: string } | null }>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_LENGTH = 200;

/** True for a syntactically valid, length-bounded email. */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_EMAIL_LENGTH &&
    EMAIL_RE.test(trimmed)
  );
}

/** Normalizes an email for storage (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Inserts one interest signup. `insert` is null when Supabase isn't configured
 * (→ "unconfigured", so the UI can show the blog fallback). A 23505 unique
 * violation → "duplicate". Any other failure (incl. a thrown error) → "error".
 */
export async function submitInterest(
  insert: InterestInserter | null,
  row: InterestRow,
): Promise<SubmitStatus> {
  if (insert === null) return "unconfigured";
  try {
    const { error } = await insert("interest_signups", row);
    if (error === null) return "ok";
    if (error.code === "23505") return "duplicate";
    return "error";
  } catch {
    return "error";
  }
}
