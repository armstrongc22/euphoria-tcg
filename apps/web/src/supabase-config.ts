/**
 * Supabase configuration detection — pure, no network, no SDK import.
 *
 * The web app reads two build-time env vars (Vite inlines anything prefixed
 * VITE_): VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. When BOTH are present
 * and non-empty the app runs in "real account" mode against Supabase; when
 * either is missing it degrades to the localStorage demo flow (see auth.ts).
 *
 * Only the anon (publishable) key belongs here. NEVER reference a service_role
 * key in client code — it bypasses Row Level Security.
 *
 * Reads are parameterized via an env-like record so this module is unit-testable
 * without a bundler; the real app passes import.meta.env.
 */

/** A resolved, validated Supabase config. */
export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

/** The subset of env we read. import.meta.env satisfies this shape. */
export type EnvLike = Record<string, string | boolean | undefined>;

function readString(env: EnvLike, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns the Supabase config when both env vars are present and non-empty,
 * otherwise null. Whitespace-only values count as missing.
 */
export function readSupabaseConfig(
  env: EnvLike = import.meta.env,
): SupabaseConfig | null {
  const url = readString(env, "VITE_SUPABASE_URL");
  const anonKey = readString(env, "VITE_SUPABASE_ANON_KEY");
  if (url === null || anonKey === null) return null;
  return { url, anonKey };
}

/** True when Supabase is fully configured (both env vars present). */
export function isSupabaseConfigured(env: EnvLike = import.meta.env): boolean {
  return readSupabaseConfig(env) !== null;
}
