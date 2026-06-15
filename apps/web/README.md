# @euphoria/web — Card Viewer

Public card viewer for the Euphoria TCG. Vanilla TypeScript + Vite. It reads
the card set from `data/cards/cards.json` (validated at build time with the
shared zod schema) and the art from `assets/cards/`.

## Develop

```bash
npm run web:dev      # from repo root  → http://localhost:5173
# or: npm run dev --workspace @euphoria/web
```

## Supabase Auth (Phase 1)

The signup flow uses **Supabase Auth** (email + password) and a
`public.profiles` table to remember each player's selected starter faction.
It is configured entirely through two **public** build-time env vars; if either
is missing the app transparently falls back to a **localStorage demo mode** so
the static site still works with no backend.

### Configure locally

1. Copy the example env file and fill in your project's values:

   ```bash
   cp apps/web/.env.local.example apps/web/.env.local
   ```

2. Set both vars (Supabase dashboard → **Project Settings → API**):

   | Variable                 | Value                                              |
   | ------------------------ | -------------------------------------------------- |
   | `VITE_SUPABASE_URL`      | Project URL, e.g. `https://<ref>.supabase.co`      |
   | `VITE_SUPABASE_ANON_KEY` | The **anon / publishable** key                     |

   > ⚠️ Use the **anon** key only. Never put the `service_role` key in a
   > `VITE_` var or any client file — it bypasses Row Level Security and would
   > be shipped to every visitor. `.env.local` is gitignored.

3. Restart `npm run web:dev` (Vite inlines env at startup).

### Expected Supabase setup

- **Auth → Email**: email confirmation **OFF** for the beta, so users continue
  immediately after signup.
- **`public.profiles`** table:

  | Column             | Type          | Notes                              |
  | ------------------ | ------------- | ---------------------------------- |
  | `id`               | `uuid` PK     | references `auth.users(id)`        |
  | `email`            | `text`        |                                    |
  | `selected_faction` | `text`        | Dwarf / Monk / Sonic / Surfer      |
  | `created_at`       | `timestamptz` | DB default on insert               |
  | `updated_at`       | `timestamptz` | written by the app on each upsert  |

- **RLS**: policies allowing each user to `select` / `insert` / `update` only
  their own row (`auth.uid() = id`).

### How the app uses it

- `src/supabase-config.ts` — detects the env vars (pure, tested).
- `src/supabase-client.ts` — the only module importing `@supabase/supabase-js`.
- `src/auth.ts` — the backend-agnostic `Auth` interface, with a Supabase backend
  and a localStorage demo backend; `createAuth()` picks one based on config.
- `src/account-view.ts` — the Account page (email, faction, starter deck,
  progression + reward placeholders, sign out).

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset, the signup form
still works and persists to localStorage only (demo mode).

## Build

```bash
npm run web:build    # outputs apps/web/dist (gitignored)
npm run preview --workspace @euphoria/web   # serve the build locally
```

## Deploy (GitHub Pages)

The build is fully static (HTML/CSS/JS + card images). It is published to
GitHub Pages automatically by `.github/workflows/deploy-pages.yml` on every
push to `main`/`master` (and via manual "Run workflow"). The workflow installs
deps, runs the tests, typecheck, and card validation, then builds with the
sub-path base and uploads `apps/web/dist`.

Live site: **https://armstrongc22.github.io/euphoria-tcg/**

One-time repository setup: in **Settings → Pages**, set **Source** to
**GitHub Actions**.

To enable real Supabase accounts on the deployed site, add the two env vars as
repository **variables** (not secrets — these are public client-side values)
under **Settings → Secrets and variables → Actions → Variables**:
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The deploy workflow passes
them to the build. Without them, the deployed site runs in localStorage demo
mode.

For a host that serves at a sub-path (e.g. GitHub Pages project sites at
`/<repo>/`), the base must match. The workflow sets it; to reproduce locally:

```bash
VITE_BASE=/euphoria-tcg/ npm run web:build
```

`base` defaults to `/` for local dev/preview. Image URLs derive from
`import.meta.env.BASE_URL`, so art resolves under any base.

## Layout

- `src/cards.ts` — browser-safe card data (JSON + zod validation) and image URLs
- `src/filters.ts` — pure filter/search logic (faction, type, cost, text)
- `src/sort.ts` — deterministic display order
- `src/controls.ts` — filter bar UI
- `src/grid.ts` — card grid (selectable cards)
- `src/detail.ts` — card detail modal + pure field derivation
- `src/signup-view.ts` — beta signup form (email + password) → starter decks
- `src/account-view.ts` — Account page (email, faction, deck, sign out)
- `src/supabase-config.ts` / `src/supabase-client.ts` / `src/auth.ts` — auth layer
- `src/main.ts` — wiring
- `test/` — unit tests for the pure logic (data, filters, sort, detail fields,
  config detection, profile payload, fallback behavior, account rendering)
