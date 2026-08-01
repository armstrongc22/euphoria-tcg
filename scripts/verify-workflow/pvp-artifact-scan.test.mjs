// @vitest-environment node
/**
 * Runner-level regression tests for verify-pvp-preview.yml.
 *
 * The failed preview run uploaded an artifact containing the Supavisor pooler
 * hostname, its resolved IP and the preview project ref. The scripts now redact
 * at the source; this file pins the runner's defence in depth:
 *
 *   1. the pre-upload scan is EXTRACTED FROM THE WORKFLOW AND EXECUTED against
 *      leaky reports — a forced metadata leak must fail it;
 *   2. the upload step is gated on that scan, so a leak blocks the upload;
 *   3. a clean report still passes (the gate is usable, not just strict);
 *   4. the artifact is named pvp-preview-verification;
 *   5. the production guards, immutable-SHA validation, protected Environment,
 *      pinned actions, concurrency, permissions and fail-closed piping survive.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows/verify-pvp-preview.yml",
);
const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf8");
const LINES = WORKFLOW.split("\n");

/** Fake values — RFC 5737 / RFC 3849 documentation addresses, invented refs. */
const FAKE = {
  poolerHost: "aws-0-us-fake-1.pooler.supabase.com",
  directHost: "db.fakepreviewrefabcxyz.supabase.co",
  ipv4: "198.51.100.42",
  ipv6Full: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  ipv6Compressed: "2001:db8::1",
  previewRef: "fakepreviewrefabcxyz",
  prodRef: "fakeprodrefabcdwxyz1",
  dbUser: "postgres.fakepreviewrefabcxyz",
  uri: "postgresql://postgres.fakepreviewrefabcxyz:s3cr3tFakePw@aws-0-us-fake-1.pooler.supabase.com:5432/postgres",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.FaKeSiGnAtUrEvAlUe",
  key: "sb_secret_FAKEfakeFAKE1234567890",
  authHeader: "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.FaKeSiG",
};

/** A realistic, fully sanitized report — the scan must NOT flag this. */
const CLEAN_REPORT = `===== report-migration.txt =====
== join_pvp_room migration + metadata + fail-loud checks ==
PASS: connected to the target database
PASS: base PvP schema applied
PASS: grant migration applied (run #1)
PASS: grant migration reran (run #2, idempotent)
PASS: exactly one public.join_pvp_room overload
PASS: identity signature is (text)
  (identity arguments: p_code text)
PASS: SECURITY DEFINER
PASS: search_path is exactly 'public'
PASS: owner is the migration role (postgres)
PASS: function body unchanged by the grant migration
PASS: grant: anon execute = f
PASS: grant: authenticated execute = t
PASS: grant: service_role execute = f
FAIL: base schema failed (DATABASE_CONNECTIVITY_FAILED)
FAIL: grant migration failed (PERMISSION_DENIED: ERROR: permission denied for function join_pvp_room)
PASS: fail-loud: missing function raises
== PvP migration checks: 17 passed, 0 failed ==

===== report-api.txt =====
PASS: authenticated A joins a valid room created by B  (http=200)
PASS: anonymous RPC call is denied BY PERMISSION (not missing function)  (http=404 code=PGRST202)
PASS: service-role RPC execution is denied (intentional least privilege)  (http=403 code=42501)
PASS: cleanup removed disposable rooms and users
harness note: connection to [REDACTED_POOLER_HOST] ([REDACTED_IP]) for [REDACTED_DB_USER] on [REDACTED_PROJECT_REF]

== PvP RPC API matrix: 12 passed, 0 failed ==
`;

/** Pull a step's `run:` script out of the workflow so it can be executed. */
function extractRunScript(stepId) {
  const idIdx = LINES.findIndex((l) => new RegExp(`^\\s*id:\\s*${stepId}\\s*$`).test(l));
  expect(idIdx, `step id: ${stepId} not found`).toBeGreaterThan(-1);
  const runIdx = LINES.findIndex((l, i) => i > idIdx && /^\s*run:\s*\|\s*$/.test(l));
  expect(runIdx, `run: | not found for ${stepId}`).toBeGreaterThan(idIdx);
  const runIndent = LINES[runIdx].search(/\S/);
  const body = [];
  for (let i = runIdx + 1; i < LINES.length; i++) {
    const line = LINES[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.search(/\S/) <= runIndent) break;
    body.push(line);
  }
  while (body.length && body[body.length - 1] === "") body.pop();
  const indent = Math.min(...body.filter((l) => l !== "").map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join("\n");
}

const SCAN_SCRIPT = extractRunScript("artifact-scan");

/** Run the extracted scan against `reportContents` (null = no report file). */
function runScan(reportContents, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "pvp-scan-"));
  try {
    const script = path.join(dir, "scan.sh");
    writeFileSync(script, SCAN_SCRIPT);
    if (reportContents !== null) writeFileSync(path.join(dir, "verification-report.txt"), reportContents);
    const res = spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        SCAN_FILES: "verification-report.txt",
        PREVIEW_REF: FAKE.previewRef,
        PROD_REF: FAKE.prodRef,
        ...env,
      },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("pre-upload artifact scan — forced leaks fail closed", () => {
  it("passes a clean, fully sanitized report", () => {
    const res = runScan(CLEAN_REPORT);
    expect(res.out).toContain("Artifact scan passed");
    expect(res.status).toBe(0);
  });

  it.each([
    ["pooler.supabase.com hostname", `PASS: ok\nnote: connected via ${FAKE.poolerHost}\n`, "Supavisor pooler hostname"],
    ["db.<ref>.supabase.co hostname", `PASS: ok\nnote: host ${FAKE.directHost}\n`, "direct database hostname"],
    ["IPv4 address", `PASS: ok\nnote: resolved ${FAKE.ipv4}\n`, "IPv4 address"],
    ["full IPv6 address", `PASS: ok\nnote: resolved ${FAKE.ipv6Full}\n`, "IPv6 address (full form)"],
    ["compressed IPv6 address", `PASS: ok\nnote: resolved ${FAKE.ipv6Compressed}\n`, "IPv6 address (compressed form)"],
    ["PostgreSQL connection URI", `PASS: ok\ntried ${FAKE.uri}\n`, "PostgreSQL connection URI"],
    ["postgres.<ref> username", `PASS: ok\nuser ${FAKE.dbUser}\n`, "Supavisor tenant username"],
    ["JWT-like value", `PASS: ok\ntoken ${FAKE.jwt}\n`, "JWT-like value"],
    ["Supabase key prefix", `PASS: ok\nkey ${FAKE.key}\n`, "Supabase key prefix"],
    ["authorization header", `PASS: ok\n${FAKE.authHeader}\n`, "authorization header"],
    ["configured preview project ref", `PASS: ok\nref ${FAKE.previewRef}\n`, "configured project ref"],
    ["configured production project ref", `PASS: ok\nref ${FAKE.prodRef}\n`, "configured project ref"],
  ])("blocks upload when the report contains a %s", (_label, report, expectedPattern) => {
    const res = runScan(report);
    expect(res.status, "scan must exit non-zero").not.toBe(0);
    expect(res.out).toContain(`[${expectedPattern}]`);
    expect(res.out).toContain("Artifact upload BLOCKED");
  });

  it("reports only the pattern label and line numbers — never the matched value", () => {
    const res = runScan(`PASS: ok\nnote: ${FAKE.poolerHost} (${FAKE.ipv4}) ${FAKE.uri}\n`);
    expect(res.status).not.toBe(0);
    for (const value of Object.values(FAKE)) expect(res.out, `scan echoed ${value}`).not.toContain(value);
    expect(res.out).toMatch(/on line\(s\): 2/);
  });

  it("fails closed when the report file is missing", () => {
    const res = runScan(null);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("is missing — refusing to upload");
  });

  it("fails closed when the project-ref variables are unset", () => {
    const res = runScan(CLEAN_REPORT, { PREVIEW_REF: "", PROD_REF: "" });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("project-ref variables missing");
  });
});

describe("workflow wiring", () => {
  it("uploads under the corrected artifact name", () => {
    expect(WORKFLOW).toContain("name: pvp-preview-verification");
    expect(WORKFLOW).not.toContain("feedback-preview-verification");
  });

  it("gates the upload on the scan, so a failed or skipped scan uploads nothing", () => {
    const uploadIdx = LINES.findIndex((l) => /uses: actions\/upload-artifact@/.test(l));
    const scanIdx = LINES.findIndex((l) => /^\s*id:\s*artifact-scan\s*$/.test(l));
    expect(scanIdx).toBeGreaterThan(-1);
    expect(uploadIdx, "the scan must come before the upload").toBeGreaterThan(scanIdx);
    const uploadStep = LINES.slice(Math.max(0, uploadIdx - 4), uploadIdx).join("\n");
    expect(uploadStep).toMatch(/if:\s*always\(\)\s*&&\s*steps\.artifact-scan\.outcome == 'success'/);
  });

  it("keeps the scan script inside the YAML block scalar (nothing truncated)", () => {
    // A line that dedents out of the block would silently truncate the script
    // on the runner; extraction stops at the same boundary, so assert the whole
    // body — heredoc terminator included — survived.
    expect(SCAN_SCRIPT).toMatch(/\nPATTERNS\n\)\n/);
    expect(SCAN_SCRIPT.trim().endsWith('echo "Artifact scan passed: no forbidden patterns in $SCAN_FILES."')).toBe(true);
  });

  it("runs the scan even when an earlier step failed", () => {
    const scanIdx = LINES.findIndex((l) => /^\s*id:\s*artifact-scan\s*$/.test(l));
    expect(LINES.slice(scanIdx, scanIdx + 3).join("\n")).toMatch(/if:\s*always\(\)/);
  });
});

describe("existing safety properties are preserved", () => {
  it("keeps the production identity guards", () => {
    expect(WORKFLOW).toContain("PRODUCTION_SUPABASE_PROJECT_REF variable is not set");
    expect(WORKFLOW).toContain("Preview project ref equals the production project ref");
    expect(WORKFLOW).toContain("Preview URL resolves to the production project ref");
    expect(WORKFLOW).toContain("Preview DB URL references the production project ref");
    expect(WORKFLOW).toContain("ALLOW_FEEDBACK_PREVIEW_TESTS");
  });

  it("keeps immutable target_sha validation", () => {
    expect(WORKFLOW).toContain("^[0-9a-f]{40}$");
    expect(WORKFLOW).toContain("git merge-base --is-ancestor");
    expect(WORKFLOW).toContain("ref: ${{ inputs.target_sha }}");
  });

  it("keeps the protected environment, least-privilege permissions and concurrency", () => {
    expect(WORKFLOW).toContain("environment: feedback-preview");
    expect(WORKFLOW).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(WORKFLOW).toMatch(/concurrency:\s*\n\s*group: pvp-preview-verify\s*\n\s*cancel-in-progress: false/);
    expect(WORKFLOW).toContain("workflow_dispatch:");
    expect(WORKFLOW).not.toMatch(/^on:\s*\n\s*push:/m);
  });

  it("pins every external action to a full commit SHA", () => {
    const uses = LINES.filter((l) => /^\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const line of uses) expect(line, `unpinned action: ${line.trim()}`).toMatch(/@[0-9a-f]{40}\s*(#.*)?$/);
  });

  it("keeps fail-closed piping on every `| tee report-*` step", () => {
    const teeIdxs = LINES.map((l, i) => [l, i]).filter(([l]) => /\|\s*tee\s+report-/.test(l));
    expect(teeIdxs.length).toBeGreaterThanOrEqual(2);
    for (const [line, idx] of teeIdxs) {
      expect(
        /set -o pipefail/.test(LINES.slice(Math.max(0, idx - 6), idx).join("\n")),
        `missing 'set -o pipefail' before: ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("keeps the fallback sed sanitizer as well as the scan", () => {
    expect(WORKFLOW).toContain("[REDACTED_JWT]");
    expect(WORKFLOW).toContain("[REDACTED_KEY]");
    expect(WORKFLOW).toContain("[REDACTED_DB_URL]");
  });
});
