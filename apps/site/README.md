# @euphoria/site

The Euphoria Universe franchise site — React + Vite + React Router, deployed as a
static SPA via Cloudflare Workers static assets (see `wrangler.jsonc` at the repo
root). It consumes shared game content/logic from `@euphoria/core`; it does not
modify the game engine, card data schema, or the beta (`apps/web`).

## Develop

```bash
npm run site:dev       # vite dev server
npm run site:build     # production build → apps/site/dist
npm run site:preview   # preview the build (serves the bundled beta too)
```

## Bundled TCG beta (`/beta/`)

The playable beta (`apps/web`) ships **inside this site's deployment** so the whole
experience lives on one Cloudflare origin. `npm run build:hosted` (at the repo
root) builds the site into `apps/site/dist`, then builds the beta into
`apps/site/dist/beta` with base `/beta/`. The site's "Play Beta" buttons link to
`/beta/` (a plain `<a href>` — a real navigation, not a React route; see
`src/beta.ts`).

```bash
npm run build:hosted   # site → dist, beta → dist/beta (base /beta/)
npm run deploy:hosted   # build:hosted, then `wrangler deploy`
npm run site:preview   # smoke-test "/" and "/beta/" locally
```

To exercise the beta on its own during development, run `npm run web:dev`. The
standalone GitHub Pages build of the beta (`web:build` → `apps/web/dist`,
`VITE_BASE=/euphoria-tcg/`) is unchanged and independent of this bundle.

> **Deploy note:** the beta reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
> at build time for real accounts/rewards — set them in the Cloudflare project's
> build env (same Supabase project as the interest form), and add the Cloudflare
> domain to the Supabase **Auth → URL Configuration** allow-list so email
> confirmation/login redirects resolve. Without the vars the beta still builds and
> runs in localStorage demo mode.

## Environment

Copy `.env.local.example` → `.env.local` for local dev, and set the same vars in
the Cloudflare project for staging/production. Vite inlines `VITE_`-prefixed vars
at build time.

| Var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (same project as the beta) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key — **never** the service_role key |
| `VITE_BASE` | Optional base path (defaults to `/`) |

When the Supabase vars are absent, the interest-signup form degrades to a
blog-follow fallback rather than erroring.

## Interest signups (`interest_signups`)

The manga / Kickstarter / shop interest form (`src/signup/InterestForm.tsx`,
`src/signup/waitlist.ts`) captures supporter emails into a single Supabase table.
It is **additive** — it does not modify any existing beta table, auth, reward, or
match behavior. Phase 1 anti-abuse: an in-form honeypot, client-side email
validation, a required consent checkbox, and strict RLS (below). Phase 2
(before heavy promotion) would add Cloudflare Turnstile + a verifying Edge
Function, and export/sync to an ESP (Kit/Beehiiv) when campaigns actually send.

The form is reusable on any page via the `source` prop, e.g.
`<InterestForm source="manga" />`, `source="shop"`, `source="blog"`.

### Table + RLS

The table is **insert-only via the anon key**: anyone may insert a consented,
well-formed row, but there are **no select/update/delete policies**, so emails
can't be read or scraped with the public key — read/export only via the Supabase
dashboard or a service-role job. Run once in the Supabase SQL editor:

```sql
create table if not exists public.interest_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text not null default 'manga',
  interests   text[] not null default '{}',
  consent     boolean not null default false,
  referrer    text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  constraint interest_signups_email_format
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  constraint interest_signups_source_allowed
    check (source in ('manga','shop','blog','kickstarter','home'))
);

-- One row per email (case-insensitive); a re-signup raises 23505, which the
-- client treats as a friendly "already on the list".
create unique index if not exists interest_signups_email_unique
  on public.interest_signups (lower(email));

alter table public.interest_signups enable row level security;

-- Anyone (anon or signed-in) may INSERT a consented, well-formed row.
create policy "interest_signups_insert_anon"
  on public.interest_signups for insert
  to anon, authenticated
  with check (
    consent = true
    and char_length(email) <= 200
    and source in ('manga','shop','blog','kickstarter','home')
  );

-- No select/update/delete policies → write-only via the anon key.
```
