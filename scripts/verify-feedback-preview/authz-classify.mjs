// ============================================================================
// Shared classification helpers for the API authorization matrix.
// ============================================================================
// Pure functions (unit-tested in authz-classify.test.mjs) that keep a
// missing-table response from being mistaken for an authorization denial. The
// earlier preview run "passed" several denial checks only because the table did
// not exist (HTTP 404 / PGRST205), not because RLS/grants denied the request.

/** True when the response means the table is not in the schema (setup failure). */
export function isMissingTable(status, code) {
  return (
    status === 404 ||
    code === "PGRST205" || // PostgREST: table not found in schema cache
    code === "PGRST202" || // PostgREST: relation not exposed
    code === "42P01" //       Postgres: undefined_table
  );
}

/**
 * True only for a genuine authorization denial (RLS/grant): HTTP 401/403 or
 * Postgres 42501 (insufficient_privilege). A missing table is explicitly NOT a
 * denial, so it can never be counted as a passing "denied" assertion.
 */
export function isAuthzDenied(status, code) {
  if (isMissingTable(status, code)) return false;
  return code === "42501" || status === 401 || status === 403;
}

/**
 * Verdict for a service-role table probe run before the matrix: "missing" means
 * the migration was not applied and downstream tests must be aborted; anything
 * else means the relation exists and the matrix may proceed.
 */
export function tableProbeVerdict(status, code) {
  return isMissingTable(status, code) ? "missing" : "present";
}
