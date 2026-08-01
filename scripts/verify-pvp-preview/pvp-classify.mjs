// ============================================================================
// Shared classifier for the join_pvp_room RPC API matrix.
// ============================================================================
// PostgREST hides a function from any role that lacks EXECUTE (it returns
// PGRST202 "not found in the schema cache"), so a bare 404/PGRST202 is
// ambiguous. These helpers resolve that: given the function is PROVEN to exist
// (an authenticated call succeeded), a lower-privileged caller's refusal — an
// explicit permission error (42501/401/403) OR being hidden from its cache
// (PGRST202) — is a permission denial, never a genuine "missing function". Pure;
// unit-tested in pvp-classify.test.mjs.

/** PostgREST/Postgres codes meaning the function isn't in the caller's cache. */
export function isMissingOrHidden(code) {
  return code === "PGRST202" || code === "PGRST203" || code === "42883";
}

/** An explicit authorization error for the RPC. */
export function isPermissionError(status, code) {
  return code === "42501" || status === 401 || status === 403;
}

/**
 * True when a denied call is denied BY PERMISSION rather than because the
 * function is genuinely absent. `functionExists` must be established
 * independently (an authenticated call succeeded / the SQL grants matrix). With
 * that proof, an explicit permission error or a hidden-from-role PGRST202 both
 * count as permission; without it, nothing counts (that is a setup failure).
 */
export function deniedByPermission(status, code, functionExists) {
  if (!functionExists) return false;
  return isPermissionError(status, code) || isMissingOrHidden(code);
}
