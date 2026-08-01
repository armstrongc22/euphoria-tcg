// @vitest-environment node
/**
 * Regression tests for the preview workflow's target-branch guard.
 *
 * The guard used to hard-code `review/pvp-rpc-grants`, so the corrective
 * migration-order branch could not be verified at all. It now takes a `target_ref`
 * CHOICE input restricted to an allowlist, and — before any job that can see the
 * disposable credentials — proves the SHA is immutable, on the allowlisted
 * branch, absent from master, and the head of an open non-fork PR into master.
 *
 * The guard script is EXTRACTED FROM THE WORKFLOW AND EXECUTED against stubbed
 * `git` and `gh` binaries, so these assertions exercise the code that actually
 * runs on the runner, not a paraphrase of it.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows/verify-pvp-preview.yml",
);
const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf8");
const LINES = WORKFLOW.split("\n");

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

const GUARD = extractRunScript("validate-target");

const REPO = "armstrongc22/euphoria-tcg";
const SHA_MIGRATION_ORDER = "0770cdc6c57bdcc694f2c027ecc4e4606c3840bd";
const SHA_PVP_RPC = "f0f254afd9e4dc0bf298477a819d623a778c71ea";
const SHA_STALE = "1111111111111111111111111111111111111111";

/** One TSV row as the guard's `gh api --jq` would emit it. */
const pr = ({ headRef, headSha, headRepo = REPO, baseRef = "master", number = 92 }) =>
  [headRef, headSha, headRepo, baseRef, number].join("\t");

/**
 * Run the extracted guard with stubbed git/gh.
 *
 * git stub: `inBranch` / `inMaster` control the two --is-ancestor answers;
 *           `branchExists` controls rev-parse.
 * gh stub:  prints `prTsv` verbatim.
 */
function runGuard({
  targetRef,
  targetSha,
  prTsv = pr({ headRef: targetRef, headSha: targetSha }),
  branchExists = true,
  inBranch = true,
  inMaster = false,
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "pvp-guard-"));
  try {
    const gitStub = [
      "#!/usr/bin/env bash",
      'case "$1" in',
      "  fetch) exit 0 ;;",
      `  rev-parse) [ "\${STUB_BRANCH_EXISTS}" = "1" ] && exit 0 || exit 1 ;;`,
      "  merge-base)",
      // args: merge-base --is-ancestor <sha> <ref>
      '    target="${!#}"',
      '    case "$target" in',
      `      *master) [ "\${STUB_IN_MASTER}" = "1" ] && exit 0 || exit 1 ;;`,
      `      *)       [ "\${STUB_IN_BRANCH}" = "1" ] && exit 0 || exit 1 ;;`,
      "    esac ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n");
    const ghStub = ["#!/usr/bin/env bash", 'printf "%s" "$STUB_PR_TSV"', "", ""].join("\n");
    for (const [name, body] of [
      ["git", gitStub],
      ["gh", ghStub],
    ]) {
      const p = path.join(dir, name);
      writeFileSync(p, body);
      chmodSync(p, 0o755);
    }
    const script = path.join(dir, "guard.sh");
    writeFileSync(script, GUARD);
    const res = spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: REPO,
        TARGET_REF: targetRef,
        TARGET_SHA: targetSha,
        GH_TOKEN: "stub-token-not-a-real-credential",
        STUB_PR_TSV: prTsv ? `${prTsv}\n` : "",
        STUB_BRANCH_EXISTS: branchExists ? "1" : "0",
        STUB_IN_BRANCH: inBranch ? "1" : "0",
        STUB_IN_MASTER: inMaster ? "1" : "0",
      },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("target guard — allowlisted branches are accepted", () => {
  it.each([
    ["fix/pvp-migration-order", SHA_MIGRATION_ORDER],
    ["review/pvp-rpc-grants", SHA_PVP_RPC],
  ])("accepts %s when every other condition matches", (targetRef, targetSha) => {
    const res = runGuard({ targetRef, targetSha });
    expect(res.out).toContain("target validated");
    expect(res.status).toBe(0);
  });
});

describe("target guard — rejections", () => {
  it("rejects an arbitrary branch not on the allowlist", () => {
    const res = runGuard({ targetRef: "feature/whatever", targetSha: SHA_MIGRATION_ORDER });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("target_ref is not an allowlisted branch");
  });

  it("rejects master itself", () => {
    const res = runGuard({ targetRef: "master", targetSha: SHA_MIGRATION_ORDER });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("not an allowlisted branch");
  });

  it("rejects a fork PR", () => {
    const res = runGuard({
      targetRef: "fix/pvp-migration-order",
      targetSha: SHA_MIGRATION_ORDER,
      prTsv: pr({
        headRef: "fix/pvp-migration-order",
        headSha: SHA_MIGRATION_ORDER,
        headRepo: "attacker/euphoria-tcg",
      }),
    });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("head is not in this repository");
  });

  it("rejects a PR whose head repo was deleted", () => {
    const res = runGuard({
      targetRef: "fix/pvp-migration-order",
      targetSha: SHA_MIGRATION_ORDER,
      prTsv: pr({ headRef: "fix/pvp-migration-order", headSha: SHA_MIGRATION_ORDER, headRepo: "DELETED" }),
    });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("head is not in this repository");
  });

  it("rejects a PR targeting a branch other than master", () => {
    const res = runGuard({
      targetRef: "fix/pvp-migration-order",
      targetSha: SHA_MIGRATION_ORDER,
      prTsv: pr({ headRef: "fix/pvp-migration-order", headSha: SHA_MIGRATION_ORDER, baseRef: "develop" }),
    });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("targets 'develop', not master");
  });

  it("rejects a stale SHA that is behind the current PR head", () => {
    const res = runGuard({
      targetRef: "fix/pvp-migration-order",
      targetSha: SHA_STALE,
      prTsv: pr({ headRef: "fix/pvp-migration-order", headSha: SHA_MIGRATION_ORDER }),
    });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("is not the current head of PR");
  });

  it("rejects a SHA already contained in master", () => {
    const res = runGuard({
      targetRef: "fix/pvp-migration-order",
      targetSha: SHA_MIGRATION_ORDER,
      inMaster: true,
    });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("already contained in master");
  });

  it("rejects a SHA that is not in the target branch's history", () => {
    const res = runGuard({ targetRef: "fix/pvp-migration-order", targetSha: SHA_MIGRATION_ORDER, inBranch: false });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("not contained in origin/fix/pvp-migration-order");
  });

  it("rejects when the branch does not exist on origin", () => {
    const res = runGuard({ targetRef: "fix/pvp-migration-order", targetSha: SHA_MIGRATION_ORDER, branchExists: false });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("does not exist");
  });

  it("rejects when no open PR exists for the branch", () => {
    const res = runGuard({ targetRef: "fix/pvp-migration-order", targetSha: SHA_MIGRATION_ORDER, prTsv: "" });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("found 0");
  });

  it("rejects when more than one open PR has that head branch", () => {
    const two = [
      pr({ headRef: "fix/pvp-migration-order", headSha: SHA_MIGRATION_ORDER, number: 92 }),
      pr({ headRef: "fix/pvp-migration-order", headSha: SHA_MIGRATION_ORDER, number: 93 }),
    ].join("\n");
    const res = runGuard({ targetRef: "fix/pvp-migration-order", targetSha: SHA_MIGRATION_ORDER, prTsv: two });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("found 2");
  });

  it.each([
    ["ref expression", "fix/pvp-migration-order@{1}"],
    ["reflog/upstream expression", "master@{upstream}"],
    ["caret parent expression", "fix/pvp-migration-order^"],
    ["tilde expression", "fix/pvp-migration-order~1"],
    ["fully-qualified ref", "refs/heads/fix/pvp-migration-order"],
    ["pull-request merge ref", "refs/pull/92/merge"],
    ["fork-style ref", "attacker:fix/pvp-migration-order"],
    ["command substitution", "$(id)"],
    ["backtick substitution", "`id`"],
    ["command chaining", "fix/pvp-migration-order; id"],
    ["pipe metacharacter", "fix/pvp-migration-order | id"],
    ["newline injection", "fix/pvp-migration-order\nmaster"],
    ["glob", "fix/*"],
    ["trailing whitespace", "fix/pvp-migration-order "],
    ["empty", ""],
  ])("rejects a ref-expression / metacharacter branch name: %s", (_label, targetRef) => {
    const res = runGuard({ targetRef, targetSha: SHA_MIGRATION_ORDER });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("not an allowlisted branch");
    // The guard must refuse before it ever reaches git or the PR lookup.
    expect(res.out).not.toContain("target validated");
  });

  it.each([
    ["short SHA", "0770cdc"],
    ["uppercase SHA", SHA_MIGRATION_ORDER.toUpperCase()],
    ["non-hex", "z770cdc6c57bdcc694f2c027ecc4e4606c3840bd"],
    ["ref expression instead of a SHA", "HEAD~1"],
    ["branch name instead of a SHA", "fix/pvp-migration-order"],
    ["41 chars", `${SHA_MIGRATION_ORDER}a`],
    ["empty", ""],
  ])("rejects a target_sha that is not a full lowercase 40-hex SHA: %s", (_label, targetSha) => {
    const res = runGuard({ targetRef: "fix/pvp-migration-order", targetSha });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("must be a full 40-character lowercase hexadecimal commit SHA");
  });
});

describe("workflow wiring", () => {
  it("exposes target_ref as a choice input restricted to the two allowlisted branches", () => {
    expect(WORKFLOW).toMatch(/target_ref:[\s\S]*?type: choice[\s\S]*?options:\s*\n\s*- review\/pvp-rpc-grants\s*\n\s*- fix\/pvp-migration-order/);
  });

  it("the allowlist in the guard script matches the choice options exactly", () => {
    const cases = [...GUARD.matchAll(/^\s*(\S+)\)\s*;;\s*$/gm)].map((m) => m[1]);
    expect(cases).toEqual(["review/pvp-rpc-grants", "fix/pvp-migration-order"]);
  });

  it("grants only read-only PR metadata on top of contents: read", () => {
    expect(WORKFLOW).toMatch(/safety-guard:[\s\S]*?permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: read/);
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s*contents: read\s*$/m);
    expect(WORKFLOW).not.toMatch(/pull-requests: write|contents: write|packages:|actions: write|id-token:/);
  });

  it("never exposes the disposable Environment or its secrets to the guard job", () => {
    const start = WORKFLOW.indexOf("  safety-guard:");
    const end = WORKFLOW.indexOf("\n  verify:");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const guardBlock = WORKFLOW.slice(start, end);
    // No Environment declaration, so protected-Environment secrets are unreachable.
    expect(guardBlock).not.toContain("environment:");
    // No FEEDBACK_PREVIEW_* SECRET reference. Reading the project-ref *variable*
    // is expected and safe — that is how the production-identity check works.
    expect(guardBlock).not.toMatch(/secrets\.FEEDBACK_PREVIEW_/);
    expect(guardBlock).toMatch(/vars\.FEEDBACK_PREVIEW_PROJECT_REF/);
    // The only secret the guard may see is the automatic GITHUB_TOKEN.
    const secretRefs = [...guardBlock.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(secretRefs)]).toEqual(["GITHUB_TOKEN"]);
  });

  it("checks out the immutable SHA for verification, never the mutable branch head", () => {
    const verifyBlock = WORKFLOW.slice(WORKFLOW.indexOf("  verify:"));
    expect(verifyBlock).toContain("ref: ${{ inputs.target_sha }}");
    expect(verifyBlock).not.toContain("ref: ${{ inputs.target_ref }}");
  });

  it("preserves every pre-existing safety control", () => {
    // production-vs-preview fail-closed guards
    expect(WORKFLOW).toContain("PRODUCTION_SUPABASE_PROJECT_REF variable is not set");
    expect(WORKFLOW).toContain("Preview project ref equals the production project ref");
    expect(WORKFLOW).toContain("Preview URL resolves to the production project ref");
    expect(WORKFLOW).toContain("Preview DB URL references the production project ref");
    // protected environment, concurrency, dispatch-only
    expect(WORKFLOW).toContain("environment: feedback-preview");
    expect(WORKFLOW).toMatch(/concurrency:\s*\n\s*group: pvp-preview-verify\s*\n\s*cancel-in-progress: false/);
    expect(WORKFLOW).toContain("workflow_dispatch:");
    expect(WORKFLOW).not.toMatch(/^on:\s*\n\s*push:/m);
    // cleanup, verdict gate, redaction, pre-upload scan
    expect(WORKFLOW).toContain("cleanup-run.mjs");
    expect(WORKFLOW).toContain("Require OVERALL PASS from every stage");
    expect(WORKFLOW).toContain("[REDACTED_JWT]");
    expect(WORKFLOW).toContain("Artifact upload BLOCKED");
    expect(WORKFLOW).toContain("name: pvp-preview-verification");
    expect(WORKFLOW).toMatch(/if:\s*always\(\)\s*&&\s*steps\.artifact-scan\.outcome == 'success'/);
  });

  it("pins every external action to a full commit SHA", () => {
    const uses = LINES.filter((l) => /^\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const line of uses) expect(line, `unpinned: ${line.trim()}`).toMatch(/@[0-9a-f]{40}\s*(#.*)?$/);
  });

  it("keeps fail-closed shell behaviour in the guard", () => {
    expect(GUARD.startsWith("set -euo pipefail")).toBe(true);
    expect(GUARD).toMatch(/\nPATTERNS\n|exit 1/);
  });
});
