import { describe, expect, it, vi } from "vitest";
import {
  isValidEmail,
  normalizeEmail,
  submitInterest,
  type InterestRow,
} from "../src/signup/waitlist";

const ROW: InterestRow = {
  email: "fan@example.com",
  source: "manga",
  interests: ["kickstarter", "manga"],
  consent: true,
  referrer: null,
  user_agent: null,
};

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  fan@example.com ")).toBe(true);
  });

  it("rejects blanks and malformed input", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.co")).toBe(false);
  });

  it("rejects over-long addresses", () => {
    expect(isValidEmail("a".repeat(200) + "@example.com")).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  FAN@Example.COM ")).toBe("fan@example.com");
  });
});

describe("submitInterest", () => {
  it("returns 'unconfigured' when there is no inserter", async () => {
    expect(await submitInterest(null, ROW)).toBe("unconfigured");
  });

  it("returns 'ok' on a clean insert into interest_signups", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    expect(await submitInterest(insert, ROW)).toBe("ok");
    expect(insert).toHaveBeenCalledWith("interest_signups", ROW);
  });

  it("maps a 23505 unique violation to 'duplicate'", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    expect(await submitInterest(insert, ROW)).toBe("duplicate");
  });

  it("returns 'error' on any other Postgres failure", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: "42501", message: "rls denied" } });
    expect(await submitInterest(insert, ROW)).toBe("error");
  });

  it("returns 'error' when the insert throws", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await submitInterest(insert, ROW)).toBe("error");
  });
});
