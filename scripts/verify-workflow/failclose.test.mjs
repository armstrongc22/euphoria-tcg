// @vitest-environment node
/**
 * Regression tests for the preview-verification workflow's fail-closed piping.
 *
 * The earlier run reported "success" even though the migration/API/app scripts
 * exited non-zero, because `script | tee report.txt` returns tee's exit code
 * (0) unless pipefail is set. These tests prove (a) pipefail makes a piped
 * failure fail, (b) the original bug (without pipefail a piped failure is
 * masked), and (c) every `| tee report-*` step in the workflow enables pipefail
 * — so a genuine failure can never again turn the run green.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows/verify-feedback-preview.yml",
);
const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf8");

/** Exit status of a bash snippet. */
function bashStatus(script) {
  return spawnSync("bash", ["-c", script], { encoding: "utf8" }).status;
}

describe("workflow fail-closed piping", () => {
  it("a forced shell failure through a pipe FAILS under pipefail (the fix)", () => {
    expect(bashStatus("set -o pipefail; false | tee /dev/null")).not.toBe(0);
  });

  it("demonstrates the original bug: without pipefail a piped failure is masked", () => {
    expect(bashStatus("false | tee /dev/null")).toBe(0);
  });

  it("every `| tee report-*` step in the workflow enables pipefail", () => {
    const lines = WORKFLOW.split("\n");
    const teeIdxs = lines
      .map((l, i) => [l, i])
      .filter(([l]) => /\|\s*tee\s+report-/.test(l));
    // The four data-producing steps: migration, schema, api, app.
    expect(teeIdxs.length).toBeGreaterThanOrEqual(4);
    for (const [line, idx] of teeIdxs) {
      const preceding = lines.slice(Math.max(0, idx - 6), idx).join("\n");
      expect(
        /set -o pipefail/.test(preceding),
        `missing 'set -o pipefail' before: ${line.trim()}`,
      ).toBe(true);
    }
  });
});
