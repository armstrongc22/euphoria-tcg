// ============================================================================
// Redaction for everything the PvP preview verification prints.
// ============================================================================
// The verification runs against a disposable Supabase project, but its output
// is uploaded as a CI artifact — so the output must never carry infrastructure
// identifiers, not just credentials. A previous run leaked a pooler hostname,
// its resolved IP, and the preview project ref straight out of psql's stderr.
//
// `redact()` is the single chokepoint: it is applied to every line the scripts
// emit (see the console wrappers in pvp-authz-test.mjs / cleanup-run.mjs and
// the classifier in db-error.mjs). It is pure and order-sensitive — connection
// URIs are collapsed before their component parts, so a URI never leaves a
// half-redacted remainder behind. Regression fixtures: redact.fixtures.mjs.

/** Supabase project refs are 20-character lowercase alphanumeric slugs. */
const PROJECT_REF = /\b(?=[a-z0-9]{20}\b)(?=[a-z0-9]*[a-z])[a-z0-9]{20}\b/g;

/**
 * Ordered redaction rules. Earlier rules win, so composite values (URIs,
 * headers) are collapsed before the host / user / ref rules can see them.
 */
export const RULES = [
  // --- credentials and transport headers ------------------------------------
  [/\b(authorization|apikey|api-key|x-api-key)\s*[:=]\s*\S+/gi, "$1: [REDACTED_AUTH_HEADER]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED_TOKEN]"],
  // Whole connection URIs (they embed user, password, host, port and ref).
  [/\bpostgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DB_URI]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi, "[REDACTED_URI_WITH_CREDENTIALS]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED_JWT]"],
  [/\bsb[a-z]*_[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]"],
  [/\b(password|pgpassword)\s*[:=]\s*\S+/gi, "$1=[REDACTED]"],

  // --- infrastructure hostnames --------------------------------------------
  // Supavisor pooler, e.g. aws-0-us-east-1.pooler.supabase.com
  [/\b[A-Za-z0-9_.-]*pooler\.supabase\.[a-z]{2,}/gi, "[REDACTED_POOLER_HOST]"],
  // Direct database host, e.g. db.<ref>.supabase.co
  [/\bdb\.[A-Za-z0-9-]+\.supabase\.[a-z]{2,}/gi, "[REDACTED_DB_HOST]"],
  // Any other <sub>.supabase.<tld> host (API/REST/storage endpoints).
  [/\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.supabase\.[a-z]{2,}/gi, "[REDACTED_SUPABASE_HOST]"],

  // --- usernames embedded in database errors --------------------------------
  [/\b(user|role)\s+"[^"]*"/gi, '$1 "[REDACTED_DB_USER]"'],
  [/\bfor\s+(user|role)\s+[A-Za-z0-9_.$-]+/gi, "for $1 [REDACTED_DB_USER]"],
  // Supavisor tenant username, e.g. postgres.<project-ref>
  [/\bpostgres\.[A-Za-z0-9-]{8,}/g, "[REDACTED_DB_USER]"],

  // --- network addresses ----------------------------------------------------
  // IPv6, full form (4+ hextets) — narrow enough not to eat clock times.
  [/(?<![\w:.])(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}(?![\w:.])/g, "[REDACTED_IP]"],
  // IPv6, compressed form (anything containing "::").
  [
    /(?<![\w:.])(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?(?![\w:.])/g,
    "[REDACTED_IP]",
  ],
  [/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g, "[REDACTED_IP]"],

  // --- project references ---------------------------------------------------
  [PROJECT_REF, "[REDACTED_PROJECT_REF]"],
];

/** Environment variables that may hold the configured preview project ref. */
const REF_ENV_VARS = [
  "SUPABASE_PROJECT_REF",
  "PREVIEW_PROJECT_REF",
  "FEEDBACK_PREVIEW_PROJECT_REF",
  "PRODUCTION_SUPABASE_PROJECT_REF",
];

/** Configured project refs, read from the environment (never printed). */
export function envProjectRefs(env = process.env) {
  return REF_ENV_VARS.map((k) => env[k])
    .filter((v) => typeof v === "string" && v.trim().length >= 4)
    .map((v) => v.trim());
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redact every known credential and infrastructure identifier from `text`.
 * `extraSecrets` are literal values (e.g. the configured project ref) that are
 * removed in addition to the pattern rules; they default to the environment.
 */
export function redact(text, { extraSecrets = envProjectRefs() } = {}) {
  let out = typeof text === "string" ? text : String(text);
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  for (const secret of extraSecrets) {
    out = out.replace(new RegExp(escapeRe(secret), "gi"), "[REDACTED_PROJECT_REF]");
  }
  return out;
}

/**
 * Replace console.log/console.error with redacting versions. Called at the top
 * of every script that prints, so no code path can bypass `redact()`.
 */
export function installRedactingConsole(target = console) {
  for (const method of ["log", "error", "warn", "info"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => original(redact(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")));
  }
}
