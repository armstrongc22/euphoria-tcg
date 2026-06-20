/**
 * describeError: readable text for thrown values, especially Supabase/PostgREST
 * error objects (plain objects, not Error instances) that otherwise stringify to
 * "[object Object]" and hide the real Postgres cause.
 */
import { describe, expect, it } from "vitest";
import { describeError } from "../src/errors";

describe("describeError", () => {
  it("uses an Error's message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("returns a string as-is", () => {
    expect(describeError("plain message")).toBe("plain message");
  });

  it("extracts message + code from a Supabase/PostgREST error object", () => {
    // This is the exact shape that was showing up as "[object Object]".
    const pgError = {
      message: 'new row violates row-level security policy for table "owned_cards"',
      details: null,
      hint: null,
      code: "42501",
    };
    const text = describeError(pgError);
    expect(text).toContain("violates row-level security policy");
    expect(text).toContain("[42501]");
    expect(text).not.toContain("[object Object]");
  });

  it("includes details and hint when present", () => {
    const text = describeError({
      message: "insert failed",
      details: "column missing",
      hint: "run the migration",
      code: "PGRST204",
    });
    expect(text).toContain("insert failed");
    expect(text).toContain("column missing");
    expect(text).toContain("hint: run the migration");
    expect(text).toContain("[PGRST204]");
  });

  it("falls back to JSON for an object with no message", () => {
    expect(describeError({ status: 500 })).toBe('{"status":500}');
  });

  it("never yields a bare [object Object] for an object error", () => {
    expect(describeError({ message: "x" })).not.toBe("[object Object]");
  });
});
