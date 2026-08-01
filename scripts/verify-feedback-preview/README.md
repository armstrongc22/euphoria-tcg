# feedback_reports — preview-branch verification bundle

Verifies the PR #85 `feedback_reports` migration, RLS/grants, and the app's
queue/dead-letter logic against a **disposable, non-production** Supabase
project or preview branch — through Supabase's real SQL and API layers.

> ⚠️ **NEVER use production credentials.** Use a throwaway Supabase project (or
> a preview branch you can delete). Everything here reads credentials only from
> environment variables / GitHub Secrets. Nothing is hard-coded. The GitHub
> workflow additionally **refuses to run** if the target matches production.

## What's in here

| File | Purpose |
| --- | --- |
| `run-migration-checks.sh` | Applies the exact PR #85 migration, verifies an idempotent rerun, and proves the stale/incompatible-table guard fails loudly. Needs `psql` + `SUPABASE_DB_URL`. |
| `schema-checks.sql` | Read-only PASS/FAIL over columns, defaults, constraints, indexes, RLS, policies, ownership, and grants. Run via `psql` or paste into the SQL Editor. |
| `api-authz-test.mjs` | Real API-layer matrix (anon / user A / user B / service_role) via `@supabase/supabase-js`: insert/select/update/delete, spoof prevention, no-`.select()` / returned-representation, `client_key` dedup. Creates + deletes disposable users. |
| `app-integration-test.ts` | Drives the real `@euphoria/core` feedback queue against the branch: one-row submit, transient→queue, reconnect→persist-once→clear, no-duplicate retry, permanent→dead-letter, dead-letter not retried, and a no-secret-stored assertion. Run with `npx --no-install tsx`. |
| `cleanup-run.mjs` | Belt-and-braces cleanup: deletes any leaked `fbverify+<run-id>-…` users (cascading their rows). Runs as an `if: always()` CI step. |

> **The workflow is NOT in this PR.** A `workflow_dispatch` workflow must live on
> the **default branch** to be dispatchable, so `verify-feedback-preview.yml`
> ships as a **separate workflow-only PR** (branch `chore/feedback-preview-runner`
> off `master`). It checks out and tests an explicit immutable `target_sha` from
> `review/feedback-persistence` — it does not depend on this feature branch.

## 1. Create a disposable Supabase project

1. In the Supabase dashboard, create a **new throwaway project** (or a preview
   branch on a non-production project). Wait for it to finish provisioning.
2. From **Project Settings** collect (these go into env vars / Secrets — never a file):
   - **Project URL** → `SUPABASE_URL` (e.g. `https://<preview-ref>.supabase.co`)
   - **anon / publishable key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (Settings → API)
   - **Direct connection string** → `SUPABASE_DB_URL` (Settings → Database →
     Connection string → URI, port 5432)
3. Apply the migration to the branch (any one):
   - `SUPABASE_DB_URL=... bash run-migration-checks.sh` (also does the rerun + stale test), or
   - `supabase db push` after `supabase link --project-ref <preview-ref>`, or
   - paste `supabase/migrations/20260720121000_feedback_reports.sql` into the SQL Editor.
4. After applying via SQL Editor, refresh PostgREST's schema cache:
   `notify pgrst, 'reload schema';` (or wait ~a minute). Confirm the API sees
   the table before running `api-authz-test.mjs`.

## 2. Run locally

```bash
export SUPABASE_URL='https://<preview-ref>.supabase.co'
export SUPABASE_ANON_KEY='<anon key>'
export SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<preview-ref>.supabase.co:5432/postgres'

bash   scripts/verify-feedback-preview/run-migration-checks.sh
psql   "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-feedback-preview/schema-checks.sql
node   scripts/verify-feedback-preview/api-authz-test.mjs
npx tsx scripts/verify-feedback-preview/app-integration-test.ts
```

Each script prints `PASS:`/`FAIL:` lines and a summary, and exits non-zero on
any failure. None of them print keys, tokens, or connection strings.

## 3. Run via GitHub Actions (the `chore/feedback-preview-runner` workflow)

The workflow lives on the default branch (separate PR). Configure it once:

**Repository variables** (Settings → Secrets and variables → Actions → Variables):

- `ALLOW_FEEDBACK_PREVIEW_TESTS = true`
- `PRODUCTION_SUPABASE_PROJECT_REF = <your production project ref>` — used only
  for the fail-closed inequality check; never for any DB operation.
- `FEEDBACK_PREVIEW_PROJECT_REF = <the disposable project ref>`

**Protected Environment** named `feedback-preview` (Settings → Environments →
New environment). Add its **environment secrets** (NOT general repo secrets),
all pointing at the disposable project:

- `FEEDBACK_PREVIEW_SUPABASE_URL`
- `FEEDBACK_PREVIEW_DB_URL`
- `FEEDBACK_PREVIEW_ANON_KEY`
- `FEEDBACK_PREVIEW_SERVICE_ROLE_KEY`

> **Add an approval rule** when your plan supports it: Environments →
> `feedback-preview` → **Required reviewers** (and optionally a wait timer /
> branch restriction). The secret-consuming `verify` job declares
> `environment: feedback-preview`, so the run then pauses for approval before
> any credential is exposed. The `safety-guard` job has no environment and
> therefore never receives these secrets.

**Run it:** Actions → “Verify feedback_reports (preview only)” → Run workflow.
Provide:

- `target_sha` — the **full 40-char** commit SHA to test (the tip of
  `review/feedback-persistence` that contains this bundle). The guard validates
  it is a real SHA on that branch's lineage and not a shared `master` commit,
  then the `verify` job checks out that exact SHA.
- `allow_preview_tests` — type `true`.

The run refuses unless both the input and the repo variable are `true`; refuses
if `FEEDBACK_PREVIEW_PROJECT_REF` is missing/equals `PRODUCTION_SUPABASE_PROJECT_REF`
(a missing prod ref is **not** permission to continue); binds the preview URL/DB
credentials to `FEEDBACK_PREVIEW_PROJECT_REF` before any DB call; runs all four
checks; cleans up this run's disposable users; and uploads a **sanitized**
`feedback-preview-verification` artifact (sanitization is a fallback — the
scripts never print secrets in the first place).

## Expected results

- **Migration:** clean apply ✓, idempotent rerun (no row change) ✓, stale-table
  guard fails loudly ✓.
- **Schema checks:** `ALL PASS`.
- **API matrix:** anon denied all (401/403); user A inserts own only; A cannot
  spoof B; A cannot select/update/delete; A's `.insert().select()` denied; B
  cannot see A's rows; duplicate `client_key` → `23505`/409; service_role
  retrieves.
- **App integration:** one row on submit; transient→queue; reconnect persists
  once & clears; repeated retry no duplicate; permanent→dead-letter, not
  retried; no token/key stored.

## Cleanup & credential rotation

- `api-authz-test.mjs` and `app-integration-test.ts` delete their disposable
  users and rows in a `finally` block (this never masks a test failure — the
  process still exits non-zero on any failed check). The CI workflow also runs
  `cleanup-run.mjs` as an `if: always()` step, deleting any leaked
  `fbverify+<run-id>-…` users for that run. To scope cleanup locally, export a
  `VERIFY_RUN_ID` before the scripts and reuse it for `cleanup-run.mjs`;
  otherwise remove any stray `fbverify+…@example.com` users from
  **Authentication → Users**.
- **Preserve the preview database and its logs until results are reviewed**,
  then delete the preview branch/project.
- **Rotate the `service_role` key** after verification (Settings → API →
  reset), especially if it was ever pasted into a terminal.
- Never reuse production credentials here.
