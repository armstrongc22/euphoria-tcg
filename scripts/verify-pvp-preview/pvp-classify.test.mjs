// @vitest-environment node
/**
 * Regression tests for the join_pvp_room RPC classifier: an anon/service refusal
 * must be recognised as a PERMISSION denial (the function exists but the caller
 * lacks EXECUTE — whether reported as 42501 or hidden via PGRST202), never
 * mistaken for a genuinely missing function.
 */
import { describe, it, expect } from "vitest";
import { isMissingOrHidden, isPermissionError, deniedByPermission } from "./pvp-classify.mjs";

describe("isMissingOrHidden / isPermissionError", () => {
  it("recognises hidden/missing function codes", () => {
    expect(isMissingOrHidden("PGRST202")).toBe(true);
    expect(isMissingOrHidden("PGRST203")).toBe(true);
    expect(isMissingOrHidden("42883")).toBe(true);
    expect(isMissingOrHidden("42501")).toBe(false);
  });
  it("recognises explicit permission errors", () => {
    expect(isPermissionError(403, "42501")).toBe(true);
    expect(isPermissionError(401, undefined)).toBe(true);
    expect(isPermissionError(200, undefined)).toBe(false);
  });
});

describe("deniedByPermission — only meaningful once the function is proven to exist", () => {
  it("explicit permission error on an existing function = permission denial", () => {
    expect(deniedByPermission(403, "42501", true)).toBe(true);
    expect(deniedByPermission(401, undefined, true)).toBe(true);
  });
  it("hidden-from-role (PGRST202) on an existing function = permission denial", () => {
    expect(deniedByPermission(404, "PGRST202", true)).toBe(true);
  });
  it("nothing counts when the function is absent (setup failure)", () => {
    expect(deniedByPermission(404, "PGRST202", false)).toBe(false);
    expect(deniedByPermission(403, "42501", false)).toBe(false);
  });
});
