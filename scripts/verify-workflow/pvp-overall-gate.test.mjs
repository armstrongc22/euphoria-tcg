// @vitest-environment node
/**
 * Runner-level regression tests for the OVERALL verdict gate in
 * verify-pvp-preview.yml.
 *
 * A green GitHub status is not proof: the last run's API stage was SKIPPED
 * because the migration stage failed, and only the job's own failure made that
 * visible. This gate makes the requirement explicit — every required stage must
 * have produced a report that says `OVERALL: PASS`. A report that says FAIL, a
 * report with no verdict line, or a missing report (NOT RUN) fails the workflow.
 *
 * As in the artifact-scan tests, the gate script is EXTRACTED FROM THE WORKFLOW
 * AND EXECUTED, so these assertions test the thing that actually runs.
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

const GATE_SCRIPT = extractRunScript("overall-gate");

const MIGRATION_PASS = "== PvP migration checks: 19 passed, 0 failed ==\nOVERALL: PASS\n";
const MIGRATION_FAIL = "FAIL: grant: service_role execute = t (expected f)\nOVERALL: FAIL\n";
const API_PASS = "== PvP RPC API matrix: 12 passed, 0 failed ==\nOVERALL: PASS\n";
const API_FAIL = "== PvP RPC API matrix: 11 passed, 1 failed ==\nOVERALL: FAIL\n";

/** Run the extracted gate against a set of stage reports (null = not produced). */
function runGate({ migration, api }) {
  const dir = mkdtempSync(path.join(tmpdir(), "pvp-gate-"));
  try {
    const script = path.join(dir, "gate.sh");
    writeFileSync(script, GATE_SCRIPT);
    if (migration !== null) writeFileSync(path.join(dir, "report-migration.txt"), migration);
    if (api !== null) writeFileSync(path.join(dir, "report-api.txt"), api);
    const res = spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, REQUIRED_REPORTS: "report-migration.txt report-api.txt" },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("OVERALL gate — only an explicit pass from every stage is a pass", () => {
  it("passes when both stages report OVERALL: PASS", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: API_PASS });
    expect(res.out).toContain("All required stages reported OVERALL: PASS.");
    expect(res.status).toBe(0);
  });

  it("fails when the migration stage reports OVERALL: FAIL", () => {
    const res = runGate({ migration: MIGRATION_FAIL, api: API_PASS });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("stage 'report-migration.txt' reported OVERALL: FAIL.");
  });

  it("fails when the API stage reports OVERALL: FAIL", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: API_FAIL });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("stage 'report-api.txt' reported OVERALL: FAIL.");
  });

  it("fails when a stage was skipped and produced no report (NOT RUN)", () => {
    // Exactly the last run's shape: migration failed, API step skipped.
    const res = runGate({ migration: MIGRATION_FAIL, api: null });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("stage report 'report-api.txt' was never produced — stage NOT RUN");
  });

  it("fails when a stage passed but the other never ran", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: null });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("NOT RUN");
  });

  it("fails when a report exists but carries no verdict line (truncated stage)", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: "== PvP RPC API matrix: 12 passed, 0 failed ==\n" });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("has no OVERALL verdict line");
  });

  it("does not accept a verdict embedded mid-line", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: "note: expected OVERALL: PASS here\n" });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("has no OVERALL verdict line");
  });

  it("requires exactly one verdict: two PASS lines are an ambiguous report", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: `${API_PASS}${API_PASS}` });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("2 OVERALL verdict lines (expected exactly 1)");
  });

  it("requires exactly one verdict: a PASS alongside a FAIL cannot pass", () => {
    const res = runGate({ migration: MIGRATION_PASS, api: `${API_PASS}${API_FAIL}` });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("expected exactly 1");
  });

  it("reports every failing stage, not just the first", () => {
    const res = runGate({ migration: MIGRATION_FAIL, api: null });
    expect(res.out).toContain("report-migration.txt");
    expect(res.out).toContain("report-api.txt");
  });
});

describe("gate wiring", () => {
  it("runs even when an earlier step failed", () => {
    const idx = LINES.findIndex((l) => /^\s*id:\s*overall-gate\s*$/.test(l));
    expect(idx).toBeGreaterThan(-1);
    expect(LINES.slice(idx, idx + 3).join("\n")).toMatch(/if:\s*always\(\)/);
  });

  it("runs AFTER the upload, so the evidence is kept even on a FAIL verdict", () => {
    const uploadIdx = LINES.findIndex((l) => /uses: actions\/upload-artifact@/.test(l));
    const gateIdx = LINES.findIndex((l) => /^\s*id:\s*overall-gate\s*$/.test(l));
    expect(gateIdx).toBeGreaterThan(uploadIdx);
  });

  it("requires both stage reports", () => {
    expect(WORKFLOW).toMatch(/REQUIRED_REPORTS:\s*report-migration\.txt report-api\.txt/);
  });

  it("leaves the artifact scan and upload exactly as they were", () => {
    expect(WORKFLOW).toContain("name: pvp-preview-verification");
    expect(WORKFLOW).toMatch(/if:\s*always\(\)\s*&&\s*steps\.artifact-scan\.outcome == 'success'/);
    expect(WORKFLOW).toContain("Artifact upload BLOCKED");
    expect(WORKFLOW).toContain("[REDACTED_JWT]");
  });
});
