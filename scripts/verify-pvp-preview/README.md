# join_pvp_room — preview-branch verification bundle

Verifies the `join_pvp_room` grant-hardening migration (PR #88) against a
**disposable, non-production** Supabase project, through the real PostgreSQL
catalog and JWT-backed PostgREST calls.

> ⚠️ **NEVER use production credentials.** All scripts read only from environment
> variables / GitHub Environment secrets. The companion workflow refuses to run
> if the target matches production.

| File | Purpose |
| --- | --- |
| `run-pvp-checks.sh` | psql: apply base PvP schema + grant migration, catalog metadata (one `(text)` overload, SECURITY DEFINER, `search_path=public`, owner, body unchanged), idempotent rerun, grants matrix, and fail-loud regression (missing / wrong-signature / second-overload / not-definer / no-search_path) in rolled-back transactions so the schema is restored after each. Fail-closed. |
| `pvp-authz-test.mjs` | `@supabase/supabase-js`: real anon / user A / B / C / service_role JWT calls to `rpc('join_pvp_room')` — join valid room, cross-user, reconnect/duplicate, own-room, invalid, full, expired, identity-cannot-override-`auth.uid()`, anon denied by permission, service_role denied. Run-scoped disposable users/rooms + cleanup. |
| `pvp-classify.mjs` (+ test) | Distinguishes a permission denial (incl. PostgREST hiding the RPC from a role) from a genuinely missing function. |
| `cleanup-run.mjs` | Deletes any leaked `pvpverify+<run-id>-…` users (cascades their rooms). |

**The workflow is separate.** `verify-pvp-preview.yml` ships on the default
branch (workflow-only PR) and tests an explicit immutable `target_sha` from
`review/pvp-rpc-grants`. It reuses the protected `feedback-preview` GitHub
Environment + secrets, with the same fail-closed production guards, SHA-pinned
actions, concurrency, and sanitized artifact as the feedback verifier.

## Run locally (against a disposable project)
```bash
export SUPABASE_URL=...            # DISPOSABLE only
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:5432/postgres'
bash scripts/verify-pvp-preview/run-pvp-checks.sh
node scripts/verify-pvp-preview/pvp-authz-test.mjs
```

## Expected results
- Metadata: 1 overload, `(text)`, SECURITY DEFINER, `search_path=public`, owner `postgres`, body unchanged; rerun idempotent.
- Grants: anon `false`, authenticated `true`, service_role `false`.
- API matrix: A/B join valid rooms; reconnect idempotent; own/invalid/full/expired rejected; seat always equals the caller's `auth.uid()`; anon + service_role denied by permission (function proven to exist).
- Fail-loud: every case raises, schema restored, grants unchanged.

## Cleanup
The API test self-cleans; `cleanup-run.mjs` runs as an `if: always()` step.
Delete stray `pvpverify+…@example.com` users from Authentication → Users, and
**rotate the service_role key** after verification. Never reuse production creds.
