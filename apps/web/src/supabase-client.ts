/**
 * Supabase client factory. This is the ONLY module that imports the Supabase
 * SDK, so the rest of the app depends on the small `Auth` interface (auth.ts)
 * rather than on supabase-js directly.
 *
 * The client is created lazily and memoized: if the env vars are missing,
 * getSupabaseClient() returns null and the app falls back to the localStorage
 * demo flow. Only the anon (publishable) key is used here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  readSupabaseConfig,
  type SupabaseConfig,
} from "@euphoria/core/supabase-config";

/** Builds a Supabase client from an explicit config. */
export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      // Persist the session in localStorage and refresh it automatically so a
      // returning beta user stays signed in across reloads.
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let cached: SupabaseClient | null | undefined;

/**
 * Returns a memoized Supabase client, or null when Supabase is not configured.
 * Reads import.meta.env on first call.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = readSupabaseConfig();
  cached = config === null ? null : createSupabaseClient(config);
  return cached;
}
