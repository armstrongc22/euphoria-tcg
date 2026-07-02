# Supabase migrations — repo-backed schema changes

Database schema changes for the Euphoria beta (auth-adjacent tables, rewards,
PvP) now live as SQL migrations in the repo instead of hand-pasted SQL:

```
supabase/
  config.toml                              # CLI project name only — NO credentials
  migrations/
    20260702120000_pvp_schema.sql          # PvP lobby + live-match schema (full)
  verify/
    pvp_policies.sql                       # read-only checks: tables/RLS/policies/RPC
```

The Cloudflare-hosted app itself is unaffected: it keeps talking to Supabase
with the anon key baked in at build time (`VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` repo *variables*, as before). Migrations are a
separate, server-side concern.

## Ground rules

- **Never commit credentials.** No access tokens, DB passwords, project refs,
  or (above all) the `service_role` key anywhere in the repo. Deploy-time
  values come exclusively from GitHub Actions secrets.
- **Never edit an applied migration.** Schema changes are always a NEW file
  under `supabase/migrations/` named `YYYYMMDDHHMMSS_short_name.sql`.
- **Write idempotent SQL** (`if not exists`, `create or replace`,
  `drop ... if exists` + `create`, exception-swallowing `do $$ ... $$` blocks
  for things like publication membership). The beta database predates this
  setup — the first `db push` must be able to run over objects that already
  exist from the SQL-editor era.
- **Protected tables stay protected.** Nothing under `supabase/migrations/`
  may alter `profiles`, `match_history`, `owned_cards`, `reward_events`,
  `active_decks`, or `feedback_reports` outside a deliberate, planned task
  (see ENGINE_LOCK.md §4).
- `docs/pvp-schema.sql` is now design documentation only; the deployable copy
  is the migration file.

## Option A (recommended, already wired): GitHub Actions

`.github/workflows/supabase-migrations.yml` applies migrations with the
Supabase CLI. It runs on pushes to `master` that touch
`supabase/migrations/**`, plus manually via **Actions → Apply Supabase
migrations → Run workflow** (use a manual run the first time, right after
adding the secrets).

### One-time setup

1. GitHub repo → **Settings → Secrets and variables → Actions → Secrets** →
   add the three secrets below.
2. That's it — no Supabase-side configuration is needed for this option.

### Required secrets (values live ONLY in GitHub Actions secrets)

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → your avatar → **Account** → **Access Tokens** → *Generate new token* |
| `SUPABASE_PROJECT_ID` | Project → **Project Settings → General → Reference ID** (the 20-char ref) |
| `SUPABASE_DB_PASSWORD` | Project → **Project Settings → Database** (the database password; reset it there if lost) |

Do **not** add the `service_role` key as a secret — migrations connect to
Postgres directly and never need it.

## Option B: Supabase's native GitHub integration

Supabase can watch the repo itself: Project → **Settings → Integrations →
GitHub** → connect the repository, set *Supabase directory* to `supabase` and
the production branch to `master`. Supabase then applies new files in
`supabase/migrations/` on merge, and can spin up preview branches for PRs
(requires the Branching feature). If you enable this, **disable or delete the
GitHub Actions workflow** so migrations aren't applied twice — pick one owner.

## How future schema changes work

1. Create `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` (UTC timestamp,
   e.g. `20260815093000_pvp_room_expiry_cleanup.sql`), written idempotently.
2. Commit it on a feature branch and PR into `master` like any code change —
   the migration rides the same review flow as the code that needs it.
3. On merge to `master`, the workflow applies it (`supabase db push` skips
   files already recorded in `supabase_migrations.schema_migrations`).
4. Verify (below). The Cloudflare deploy workflow is independent; if a code
   change depends on a schema change, merge the migration first or in the same
   PR (the migrations workflow and the deploy run in parallel on the same
   push — migrations are fast, but write the app code to degrade gracefully
   for the seconds in between, which our polling/fallback clients already do).

Optional local flow (never required): `supabase link --project-ref <ref>` once,
then `supabase db push` from your machine — the CLI prompts for the same
values; nothing is stored in the repo.

## Verifying the schema

Run `supabase/verify/pvp_policies.sql` in the Supabase **SQL Editor** (it is
read-only). Expected:

1. Tables `pvp_rooms` and `pvp_matches` both exist.
2. `relrowsecurity = true` for both.
3. Exactly six policies:
   `pvp_rooms_select/insert/update`, `pvp_matches_select/insert/update`.
4. `join_pvp_room` exists with `prosecdef = true` (SECURITY DEFINER).
5. (Optional) both tables appear in the `supabase_realtime` publication —
   missing rows only mean the clients fall back to polling.
6. `to_regclass('supabase_migrations.schema_migrations')` is non-null once
   `db push` has run; list applied migrations with
   `select version, name from supabase_migrations.schema_migrations;`.

Or from the CLI: `supabase migration list` (shows local vs remote state).
