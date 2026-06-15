/**
 * Supabase config detection. Pure logic, default node env — we pass explicit
 * env-like objects rather than touching import.meta.env so the result is
 * deterministic regardless of the developer's local .env.
 */
import { describe, expect, it } from "vitest";
import {
  isSupabaseConfigured,
  readSupabaseConfig,
  type EnvLike,
} from "../src/supabase-config";

const FULL: EnvLike = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key-123",
};

describe("readSupabaseConfig", () => {
  it("returns the config when both vars are present", () => {
    expect(readSupabaseConfig(FULL)).toEqual({
      url: "https://example.supabase.co",
      anonKey: "anon-key-123",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: "  https://example.supabase.co  ",
        VITE_SUPABASE_ANON_KEY: " anon-key-123 ",
      }),
    ).toEqual({ url: "https://example.supabase.co", anonKey: "anon-key-123" });
  });

  it("returns null when the URL is missing", () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: "anon" })).toBeNull();
  });

  it("returns null when the anon key is missing", () => {
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: "https://example.supabase.co" }),
    ).toBeNull();
  });

  it("treats empty / whitespace-only values as missing", () => {
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" }),
    ).toBeNull();
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: "   ",
        VITE_SUPABASE_ANON_KEY: "anon",
      }),
    ).toBeNull();
  });

  it("returns null for a completely empty env", () => {
    expect(readSupabaseConfig({})).toBeNull();
  });
});

describe("isSupabaseConfigured", () => {
  it("is true only when both vars are present", () => {
    expect(isSupabaseConfigured(FULL)).toBe(true);
    expect(isSupabaseConfigured({})).toBe(false);
    expect(isSupabaseConfigured({ VITE_SUPABASE_URL: "x" })).toBe(false);
  });
});
