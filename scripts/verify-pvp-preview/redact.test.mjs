// @vitest-environment node
/**
 * Regression tests for PvP preview-verification output sanitization.
 *
 * A previous preview run uploaded an artifact containing the Supavisor pooler
 * hostname, its resolved IP and the preview project ref, because psql's stderr
 * was written straight into the report. These tests pin the fix at the source:
 *
 *   1. every fake infrastructure value is redacted by `redact()`;
 *   2. connection failures report ONLY `DATABASE_CONNECTIVITY_FAILED`;
 *   3. missing-function and permission-denied stay distinguishable;
 *   4. running the real `run-pvp-checks.sh` against a psql stub that spews the
 *      leaky fixture produces a report with none of those values in it.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { redact, envProjectRefs, installRedactingConsole } from "./redact.mjs";
import { classifyDbError, safeDbErrorSummary, CATEGORY } from "./db-error.mjs";
import { FAKE, FAKE_VALUES, DB_ERROR_FIXTURES } from "./redact.fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKS_SH = path.join(HERE, "run-pvp-checks.sh");

/** Assert that no fake infrastructure value survives in `text`. */
function expectNoLeaks(text) {
  for (const value of FAKE_VALUES) {
    expect(text, `leaked ${value}`).not.toContain(value);
  }
  // Shapes, not just literals: nothing that still looks like an address/host.
  expect(text).not.toMatch(/pooler\.supabase\./i);
  expect(text).not.toMatch(/db\.[A-Za-z0-9-]+\.supabase\./i);
  expect(text).not.toMatch(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/);
  expect(text).not.toMatch(/postgres(?:ql)?:\/\//i);
  expect(text).not.toMatch(/\beyJ[A-Za-z0-9_-]{5,}\./);
}

describe("redact() — every leaked shape", () => {
  it.each([
    ["Supavisor pooler hostname", FAKE.poolerHost, "[REDACTED_POOLER_HOST]"],
    ["direct db.<ref>.supabase.co hostname", FAKE.directHost, "[REDACTED_DB_HOST]"],
    ["API hostname", FAKE.apiHost, "[REDACTED_SUPABASE_HOST]"],
    ["IPv4 address", FAKE.ipv4, "[REDACTED_IP]"],
    ["full IPv6 address", FAKE.ipv6Full, "[REDACTED_IP]"],
    ["compressed IPv6 address", FAKE.ipv6Compressed, "[REDACTED_IP]"],
    ["project reference", FAKE.projectRef, "[REDACTED_PROJECT_REF]"],
    ["postgres.<project-ref> username", FAKE.dbUser, "[REDACTED_DB_USER]"],
    ["complete PostgreSQL connection URI", FAKE.connectionUri, "[REDACTED_DB_URI]"],
    ["JWT", FAKE.jwt, "[REDACTED_JWT]"],
    ["Supabase secret key", FAKE.secretKey, "[REDACTED_KEY]"],
    ["Supabase publishable key", FAKE.publishableKey, "[REDACTED_KEY]"],
  ])("redacts a %s", (_label, value, placeholder) => {
    const out = redact(`before ${value} after`, { extraSecrets: [] });
    expect(out).not.toContain(value);
    expect(out).toContain(placeholder);
    expect(out.startsWith("before ")).toBe(true);
  });

  it("redacts authorization headers and bearer tokens", () => {
    const out = redact(`authorization: Bearer ${FAKE.jwt}\napikey: ${FAKE.secretKey}`, { extraSecrets: [] });
    expect(out).not.toContain(FAKE.jwt);
    expect(out).not.toContain(FAKE.secretKey);
    expect(out).toMatch(/REDACTED_AUTH_HEADER/);
  });

  it("redacts a configured project ref supplied via the environment", () => {
    const refs = envProjectRefs({ FEEDBACK_PREVIEW_PROJECT_REF: "shortref9" });
    expect(refs).toEqual(["shortref9"]);
    expect(redact("target shortref9 here", { extraSecrets: refs })).not.toContain("shortref9");
  });

  it("leaves the report's own vocabulary intact", () => {
    const line = "PASS: grant: service_role execute = f  (http=403 code=42501)";
    expect(redact(line, { extraSecrets: [] })).toBe(line);
  });

  it("does not mistake a clock time for an IPv6 address", () => {
    expect(redact("finished at 12:34:56", { extraSecrets: [] })).toBe("finished at 12:34:56");
  });

  it("installRedactingConsole() sanitizes anything printed", () => {
    const printed = [];
    const fake = { log: (s) => printed.push(s), error: (s) => printed.push(s), warn: () => {}, info: () => {} };
    installRedactingConsole(fake);
    fake.error("harness error:", `connect ECONNREFUSED ${FAKE.ipv4} via ${FAKE.poolerHost}`);
    expectNoLeaks(printed.join("\n"));
  });
});

describe("classifyDbError() / safeDbErrorSummary()", () => {
  it.each(DB_ERROR_FIXTURES.map((f) => [f.name, f]))("classifies %s", (_name, fixture) => {
    expect(classifyDbError(fixture.stderr)).toBe(fixture.category);
  });

  it("reports connection failures as the bare generic category only", () => {
    for (const fixture of DB_ERROR_FIXTURES.filter((f) => f.category === CATEGORY.CONNECTIVITY)) {
      expect(safeDbErrorSummary(fixture.stderr)).toBe("DATABASE_CONNECTIVITY_FAILED");
    }
  });

  it("keeps missing-function and permission-denial distinguishable", () => {
    const missing = safeDbErrorSummary(DB_ERROR_FIXTURES.find((f) => f.name === "missing function").stderr);
    const denied = safeDbErrorSummary(DB_ERROR_FIXTURES.find((f) => f.name === "permission denied").stderr);
    expect(missing).toMatch(/^MISSING_FUNCTION: /);
    expect(denied).toMatch(/^PERMISSION_DENIED: /);
    expect(missing).not.toBe(denied);
    expectNoLeaks(`${missing}\n${denied}`);
  });

  it("no fixture leaks anything through its summary", () => {
    const summaries = DB_ERROR_FIXTURES.map((f) => safeDbErrorSummary(f.stderr)).join("\n");
    expectNoLeaks(summaries);
  });

  it("the db-error CLI prints only the classified summary", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pvp-cli-"));
    try {
      const file = path.join(dir, "stderr.txt");
      const kitchenSink = DB_ERROR_FIXTURES.find((f) => f.name.startsWith("kitchen sink"));
      writeFileSync(file, kitchenSink.stderr);
      const res = spawnSync("node", [path.join(HERE, "db-error.mjs"), "--file", file], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe("DATABASE_CONNECTIVITY_FAILED");
      expectNoLeaks(res.stdout + res.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * End-to-end: run the real script with a psql stub that emits a leaky stderr
 * blob, capture exactly what the workflow would tee into report-migration.txt,
 * and prove none of the fake values survive into that report.
 */
function runChecksWithStub(stubBody, fixtureStderr) {
  const dir = mkdtempSync(path.join(tmpdir(), "pvp-stub-"));
  try {
    const leak = path.join(dir, "leak.txt");
    writeFileSync(leak, fixtureStderr);
    const stub = path.join(dir, "psql");
    writeFileSync(stub, stubBody);
    chmodSync(stub, 0o755);
    const res = spawnSync("bash", [CHECKS_SH], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        LEAK_FIXTURE: leak,
        SUPABASE_DB_URL: FAKE.connectionUri,
        FEEDBACK_PREVIEW_PROJECT_REF: FAKE.projectRef,
      },
    });
    // What the workflow would write to the report is the script's stdout.
    const report = path.join(dir, "report-migration.txt");
    writeFileSync(report, res.stdout);
    return { ...res, report: readFileSync(report, "utf8"), stderrText: res.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ALWAYS_FAILS = `#!/usr/bin/env bash\ncat "$LEAK_FIXTURE" >&2\nexit 2\n`;
const CONNECTS_THEN_FAILS = [
  "#!/usr/bin/env bash",
  'for a in "$@"; do case "$a" in *"select 1"*) echo 1; exit 0;; esac; done',
  'cat "$LEAK_FIXTURE" >&2',
  "exit 3",
  "",
].join("\n");

describe("run-pvp-checks.sh — generated report never carries infrastructure values", () => {
  it("an unreachable database yields the generic category and a clean report", () => {
    const fixture = DB_ERROR_FIXTURES.find((f) => f.name.startsWith("pooler connection refused"));
    const res = runChecksWithStub(ALWAYS_FAILS, fixture.stderr);
    expect(res.status).not.toBe(0);
    expect(res.report).toContain("DATABASE_CONNECTIVITY_FAILED");
    expectNoLeaks(res.report);
    expectNoLeaks(res.stderrText);
  });

  it("the kitchen-sink stderr blob leaks nothing into the report", () => {
    const fixture = DB_ERROR_FIXTURES.find((f) => f.name.startsWith("kitchen sink"));
    const res = runChecksWithStub(ALWAYS_FAILS, fixture.stderr);
    expect(res.report).toContain("DATABASE_CONNECTIVITY_FAILED");
    expect(res.report).not.toContain("Bearer");
    expectNoLeaks(res.report);
    expectNoLeaks(res.stderrText);
  });

  it("a query-level failure is still classified, not silenced", () => {
    const denied = DB_ERROR_FIXTURES.find((f) => f.name === "permission denied");
    const res = runChecksWithStub(CONNECTS_THEN_FAILS, denied.stderr);
    expect(res.report).toContain("connected to the target database");
    expect(res.report).toContain("PERMISSION_DENIED");
    expect(res.report).not.toContain("DATABASE_CONNECTIVITY_FAILED");
    expectNoLeaks(res.report);
  });

  it("a missing function is reported as MISSING_FUNCTION, not as a connection failure", () => {
    const missing = DB_ERROR_FIXTURES.find((f) => f.name === "missing function");
    const res = runChecksWithStub(CONNECTS_THEN_FAILS, missing.stderr);
    expect(res.report).toContain("MISSING_FUNCTION");
    expect(res.report).not.toContain("DATABASE_CONNECTIVITY_FAILED");
    expectNoLeaks(res.report);
  });
});
