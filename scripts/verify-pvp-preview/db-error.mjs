// ============================================================================
// Classify a PostgreSQL / psql failure into a safe, reportable category.
// ============================================================================
// Raw psql stderr must never reach a report or artifact: connection failures in
// particular embed the pooler hostname, its resolved IP, the Supavisor tenant
// username and the project ref. So every database failure is classified first,
// and only the category (plus, for query-level errors, a redacted one-line
// detail) is reported.
//
// Connectivity failures — including authentication and pg_hba refusals, which
// carry a username — report the CATEGORY ONLY, with no detail whatsoever.
//
// Also usable as a CLI by run-pvp-checks.sh:
//     node db-error.mjs --file <stderr-file>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.mjs";

/** Categories that are safe to print. */
export const CATEGORY = {
  CONNECTIVITY: "DATABASE_CONNECTIVITY_FAILED",
  MISSING_FUNCTION: "MISSING_FUNCTION",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  MISSING_RELATION: "MISSING_RELATION",
  ASSERTION_RAISED: "MIGRATION_ASSERTION_RAISED",
  SQL_ERROR: "SQL_ERROR",
  UNKNOWN: "UNKNOWN_DATABASE_ERROR",
};

/**
 * Anything that means "we never got a usable session on the database".
 * Deliberately broad: everything matched here reports the generic category and
 * discards the message, because these are the messages that leak the host, the
 * resolved IP and the connecting username.
 */
const CONNECTIVITY_PATTERNS = [
  /connection to server/i,
  /could not connect to server/i,
  /could not translate host name/i,
  /connection refused/i,
  /no route to host/i,
  /network is unreachable/i,
  /name or service not known/i,
  /temporary failure in name resolution/i,
  /timeout expired/i,
  /connection timed out/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /SSL (SYSCALL )?error/i,
  /could not receive data from server/i,
  /could not send.*to server/i,
  /password authentication failed/i,
  /no pg_hba\.conf entry/i,
  /authentication failed/i,
  /too many (clients|connections)/i,
  /the database system is (starting up|shutting down|in recovery)/i,
  /connection is bad/i,
  /^psql: error: (?!.*\bERROR:)/im,
];

/** Query-level classifications, checked only once connectivity is ruled out. */
const QUERY_PATTERNS = [
  [CATEGORY.MISSING_FUNCTION, /\b42883\b|function .* does not exist|could not find a function/i],
  [CATEGORY.PERMISSION_DENIED, /\b42501\b|permission denied/i],
  [CATEGORY.MISSING_RELATION, /\b42P01\b|relation .* does not exist/i],
  [
    CATEGORY.ASSERTION_RAISED,
    /\bP0001\b|is missing|expected signature|exactly one overload|not SECURITY DEFINER|lacks a fixed search_path/i,
  ],
  [CATEGORY.SQL_ERROR, /^\s*ERROR:/im],
];

/** Classify without producing any text. Returns a CATEGORY value. */
export function classifyDbError(stderr) {
  const text = typeof stderr === "string" ? stderr : String(stderr ?? "");
  if (!text.trim()) return CATEGORY.UNKNOWN;
  if (CONNECTIVITY_PATTERNS.some((re) => re.test(text))) return CATEGORY.CONNECTIVITY;
  for (const [category, re] of QUERY_PATTERNS) if (re.test(text)) return category;
  return CATEGORY.UNKNOWN;
}

/** First `ERROR:` line, redacted and truncated — never used for connectivity. */
function safeDetail(text) {
  const line = text.split("\n").find((l) => /^\s*(ERROR|FATAL):/i.test(l)) ?? "";
  const detail = redact(line).trim().replace(/\s+/g, " ");
  return detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
}

/**
 * The only string a caller may report for a database failure.
 * Connectivity failures collapse to the bare category; every other category
 * keeps a redacted one-line detail so a missing function stays distinguishable
 * from a permission denial.
 */
export function safeDbErrorSummary(stderr) {
  const category = classifyDbError(stderr);
  if (category === CATEGORY.CONNECTIVITY) return CATEGORY.CONNECTIVITY;
  const detail = safeDetail(typeof stderr === "string" ? stderr : String(stderr ?? ""));
  return detail ? `${category}: ${detail}` : category;
}

// --- CLI: node db-error.mjs --file <path> -----------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--file");
  let raw = "";
  if (i !== -1 && process.argv[i + 1]) {
    try {
      raw = readFileSync(process.argv[i + 1], "utf8");
    } catch {
      raw = "";
    }
  }
  // Never echo the input: only the classified summary reaches stdout.
  process.stdout.write(`${safeDbErrorSummary(raw)}\n`);
}
