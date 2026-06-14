/**
 * Beta signup state — pure logic, no DOM, no network.
 *
 * TODO (real email capture): this is a LOCAL/DEMO implementation only. It stores
 * the email in localStorage so the beta flow works on a static GitHub Pages site
 * with no backend. Before launch, the signup submit must POST to a real provider
 * (e.g. an email/ESP API or a serverless function) instead of — or in addition
 * to — writing localStorage. Do NOT hardcode a provider here; wire it in the view
 * layer when the backend exists. Nothing below talks to a server on purpose.
 *
 * Storage is injected via the `KeyValueStore` interface so this module is fully
 * unit-testable without a browser (tests pass an in-memory fake; the app passes
 * window.localStorage via getLocalStore()).
 */
import { STARTER_FACTIONS, type StarterFaction } from "./starter";

/** localStorage key. Versioned so the shape can change later without clashes. */
export const SIGNUP_STORAGE_KEY = "euphoria.signup.v1";

/** What we persist for a beta signup. */
export interface SignupState {
  readonly email: string;
  readonly faction: StarterFaction | null;
  /** ISO timestamp of the most recent signup. */
  readonly signedUpAt: string;
}

/** The slice of the Storage API we use. localStorage satisfies this. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Pragmatic single-line email check: one @, no whitespace, a dotted domain.
// Deliberately not RFC-5322-exhaustive — good enough to catch typos for a beta.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if `email` looks like a plausible address. Trims surrounding space. */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

function isStarterFaction(value: unknown): value is StarterFaction {
  return (
    typeof value === "string" &&
    (STARTER_FACTIONS as readonly string[]).includes(value)
  );
}

/** Reads persisted signup state, or null if absent/corrupt. Never throws. */
export function loadSignup(store: KeyValueStore): SignupState | null {
  const raw = store.getItem(SIGNUP_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignupState>;
    if (typeof parsed.email !== "string") return null;
    return {
      email: parsed.email,
      faction: isStarterFaction(parsed.faction) ? parsed.faction : null,
      signedUpAt:
        typeof parsed.signedUpAt === "string"
          ? parsed.signedUpAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function save(store: KeyValueStore, state: SignupState): SignupState {
  store.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(state));
  return state;
}

/**
 * Records a beta signup email. Preserves any previously chosen faction.
 * Throws on an invalid email so callers validate first (the view does).
 */
export function recordSignup(
  store: KeyValueStore,
  email: string,
  now: Date = new Date(),
): SignupState {
  if (!isValidEmail(email)) {
    throw new Error(`Refusing to store invalid email: "${email}".`);
  }
  const existing = loadSignup(store);
  return save(store, {
    email: email.trim().toLowerCase(),
    faction: existing?.faction ?? null,
    signedUpAt: now.toISOString(),
  });
}

/**
 * Records the chosen starter faction. Works even before email signup, so a
 * visitor can browse and pick a deck first; the email (if any) is preserved.
 */
export function recordFaction(
  store: KeyValueStore,
  faction: StarterFaction,
  now: Date = new Date(),
): SignupState {
  const existing = loadSignup(store);
  return save(store, {
    email: existing?.email ?? "",
    faction,
    signedUpAt: existing?.signedUpAt ?? now.toISOString(),
  });
}

/** Clears all persisted signup state. */
export function clearSignup(store: KeyValueStore): void {
  store.removeItem(SIGNUP_STORAGE_KEY);
}

/**
 * Returns a usable localStorage, or null when it's unavailable or blocked
 * (private mode, disabled storage, SSR). The app degrades to a stateless flow
 * rather than crashing.
 */
export function getLocalStore(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage as KeyValueStore | undefined;
    if (!ls) return null;
    const probe = "__euphoria_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
