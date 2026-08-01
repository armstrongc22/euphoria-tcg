// @vitest-environment node
/**
 * Regression tests for the API authorization classifier. These lock in the fix
 * for the earlier preview run, which counted missing-table responses (404 /
 * PGRST205) as passing "denied" assertions. They prove:
 *   - a missing table is detected and stops downstream tests (probe = "missing");
 *   - a genuine RLS/grant denial (401/403/42501) is distinguished from a
 *     missing-schema failure — the two categories are disjoint.
 */
import { describe, it, expect } from "vitest";
import { isMissingTable, isAuthzDenied, tableProbeVerdict } from "./authz-classify.mjs";

describe("isMissingTable", () => {
  it("flags 404 and PostgREST/Postgres missing-relation codes", () => {
    expect(isMissingTable(404, undefined)).toBe(true);
    expect(isMissingTable(200, "PGRST205")).toBe(true);
    expect(isMissingTable(200, "PGRST202")).toBe(true);
    expect(isMissingTable(400, "42P01")).toBe(true);
  });
  it("does not flag authorization denials or successes", () => {
    expect(isMissingTable(403, "42501")).toBe(false);
    expect(isMissingTable(401, undefined)).toBe(false);
    expect(isMissingTable(200, undefined)).toBe(false);
  });
});

describe("isAuthzDenied — genuine RLS/grant denial vs missing schema", () => {
  it("treats 401 / 403 / 42501 as a real denial", () => {
    expect(isAuthzDenied(403, "42501")).toBe(true);
    expect(isAuthzDenied(401, undefined)).toBe(true);
    expect(isAuthzDenied(403, undefined)).toBe(true);
  });
  it("never treats a missing table as an authorization denial", () => {
    expect(isAuthzDenied(404, "PGRST205")).toBe(false);
    expect(isAuthzDenied(404, undefined)).toBe(false);
    expect(isAuthzDenied(200, undefined)).toBe(false);
  });
  it("missing-table and authz-denied are disjoint for the same response", () => {
    for (const [s, c] of [[404, "PGRST205"], [404, undefined], [200, "PGRST205"]]) {
      expect(isMissingTable(s, c) && isAuthzDenied(s, c)).toBe(false);
    }
  });
});

describe("tableProbeVerdict — a missing table stops downstream tests", () => {
  it("returns 'missing' for a missing table (harness aborts before the matrix)", () => {
    expect(tableProbeVerdict(404, "PGRST205")).toBe("missing");
    expect(tableProbeVerdict(404, undefined)).toBe("missing");
  });
  it("returns 'present' when the relation exists", () => {
    expect(tableProbeVerdict(200, undefined)).toBe("present");
    expect(tableProbeVerdict(206, undefined)).toBe("present");
    expect(tableProbeVerdict(403, "42501")).toBe("present"); // exists but denied
  });
});
