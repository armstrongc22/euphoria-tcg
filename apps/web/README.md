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

- **`public.match_history`** table — one row per completed test match:

  | Column                       | Type          | Notes                          |
  | ---------------------------- | ------------- | ------------------------------ |
  | `id`                         | `uuid` PK     | `default gen_random_uuid()`    |
  | `user_id`                    | `uuid`        | references `auth.users(id)`    |
  | `player_faction`             | `text`        |                                |
  | `opponent_faction`           | `text`        |                                |
  | `winner`                     | `text`        | winning faction, or `draw`     |
  | `result`                     | `text`        | `win` / `loss` / `draw`        |
  | `turns`                      | `integer`     |                                |
  | `lives_left_player`          | `integer`     |                                |
  | `lives_left_opponent`        | `integer`     |                                |
  | `warriors_summoned_player`   | `integer`     |                                |
  | `warriors_summoned_opponent` | `integer`     |                                |
  | `direct_attacks_player`      | `integer`     |                                |
  | `direct_attacks_opponent`    | `integer`     |                                |
  | `created_at`                 | `timestamptz` | DB default on insert           |

  **RLS**: each user may `select` / `insert` only their own rows
  (`auth.uid() = user_id`). Run once in the SQL editor:

  ```sql
  create table if not exists public.match_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    player_faction text not null,
    opponent_faction text not null,
    winner text not null,
    result text not null check (result in ('win', 'loss', 'draw')),
    turns integer not null,
    lives_left_player integer not null,
    lives_left_opponent integer not null,
    warriors_summoned_player integer not null,
    warriors_summoned_opponent integer not null,
    direct_attacks_player integer not null,
    direct_attacks_opponent integer not null,
    created_at timestamptz not null default now()
  );

  alter table public.match_history enable row level security;

  create policy "match_history_select_own"
    on public.match_history for select
    using (auth.uid() = user_id);

  create policy "match_history_insert_own"
    on public.match_history for insert
    with check (auth.uid() = user_id);

  create index if not exists match_history_user_created_idx
    on public.match_history (user_id, created_at desc);
  ```

  If Supabase is unavailable or unconfigured, match history persists to
  localStorage instead, so the demo flow still shows stats and never crashes.

- **`public.owned_cards`** table — one row per reward card a player has earned:

  | Column        | Type          | Notes                                   |
  | ------------- | ------------- | --------------------------------------- |
  | `id`          | `uuid` PK     | `default gen_random_uuid()`             |
  | `user_id`     | `uuid`        | references `auth.users(id)`             |
  | `card_slug`   | `text`        | the card's slug in `cards.json`         |
  | `card_name`   | `text`        | denormalized for display                |
  | `faction`     | `text`        | card faction (own faction or Neutral)   |
  | `card_type`   | `text`        | Warrior / Attack / Item / Weapon        |
  | `source`      | `text`        | `reward` (only source in the beta)      |
  | `created_at`  | `timestamptz` | DB default on insert                    |

- **`public.reward_events`** table — one row per reward choice (which options
  were offered and which was picked), kept for progression analytics:

  | Column           | Type          | Notes                                |
  | ---------------- | ------------- | ------------------------------------ |
  | `id`             | `uuid` PK     | `default gen_random_uuid()`          |
  | `user_id`        | `uuid`        | references `auth.users(id)`          |
  | `player_faction` | `text`        | the faction the offer was built for  |
  | `chosen_slug`    | `text`        | the slug the player chose            |
  | `option_slugs`   | `text[]`      | all slugs offered (includes chosen)  |
  | `milestone`      | `integer`     | win count that earned it (5,10,15,…) |
  | `tier`           | `integer`     | reward tier (`milestone / 5`)        |
  | `created_at`     | `timestamptz` | DB default on insert                 |

  Rewards are offered only on win milestones (every 5th win); `milestone`/`tier`
  are derived from the win COUNT, never from existing rows, so legacy rows whose
  `milestone` is null can't re-unlock a reward.

  **RLS** on both: each user may `select` / `insert` only their own rows
  (`auth.uid() = user_id`). Run once in the SQL editor:

  ```sql
  -- owned_cards: reward cards a player has earned -------------------------
  create table if not exists public.owned_cards (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    card_slug text not null,
    card_name text not null,
    faction text not null,
    card_type text not null check (card_type in ('Warrior', 'Attack', 'Item', 'Weapon')),
    source text not null default 'reward',
    created_at timestamptz not null default now()
  );

  alter table public.owned_cards enable row level security;

  create policy "owned_cards_select_own"
    on public.owned_cards for select
    using (auth.uid() = user_id);

  create policy "owned_cards_insert_own"
    on public.owned_cards for insert
    with check (auth.uid() = user_id);

  create index if not exists owned_cards_user_created_idx
    on public.owned_cards (user_id, created_at desc);

  -- reward_events: which options were offered and which was chosen --------
  create table if not exists public.reward_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    player_faction text not null,
    chosen_slug text not null,
    option_slugs text[] not null,
    milestone integer,
    tier integer,
    created_at timestamptz not null default now()
  );

  -- If the table predates the milestone work, add the columns in place. Leaving
  -- existing rows' milestone/tier null is fine: eligibility is derived from the
  -- win count, not from these rows.
  alter table public.reward_events add column if not exists milestone integer;
  alter table public.reward_events add column if not exists tier integer;

  alter table public.reward_events enable row level security;

  create policy "reward_events_select_own"
    on public.reward_events for select
    using (auth.uid() = user_id);

  create policy "reward_events_insert_own"
    on public.reward_events for insert
    with check (auth.uid() = user_id);

  create index if not exists reward_events_user_created_idx
    on public.reward_events (user_id, created_at desc);
  ```

  If Supabase is unavailable or unconfigured, owned reward cards persist to
  localStorage instead, so the demo flow still earns and shows rewards.

- **Starter-switch reset (DELETE policies).** Changing starter faction resets an
  account's beta progression, which requires the client to `delete` the user's
  own rows in `owned_cards`, `reward_events`, and `match_history`. The original
  policies above grant only `select`/`insert`, so **add user-scoped delete
  policies** (run once; `active_decks` already allows delete — see below). Never
  use the `service_role` key in client code; these RLS policies keep deletes
  scoped to `auth.uid() = user_id`:

  ```sql
  -- Allow each user to delete only their own progression rows (reset on switch).
  create policy "owned_cards_delete_own"
    on public.owned_cards for delete
    using (auth.uid() = user_id);

  create policy "reward_events_delete_own"
    on public.reward_events for delete
    using (auth.uid() = user_id);

  create policy "match_history_delete_own"
    on public.match_history for delete
    using (auth.uid() = user_id);
  ```

  Without these policies the reset's deletes are silently no-ops under RLS (the
  rows remain), so the switch would change the faction but not clear progression.

- **`public.active_decks`** table — a player's saved custom 30-card deck. One
  row **per user per faction** (enforced by a unique index), upserted on save:

  | Column        | Type          | Notes                                       |
  | ------------- | ------------- | ------------------------------------------- |
  | `id`          | `uuid` PK     | `default gen_random_uuid()`                 |
  | `user_id`     | `uuid`        | references `auth.users(id)`                 |
  | `faction`     | `text`        | Dwarf / Monk / Sonic / Surfer               |
  | `cards`       | `jsonb`       | `[{ "slug": "...", "quantity": N }, ...]`   |
  | `created_at`  | `timestamptz` | DB default on insert                        |
  | `updated_at`  | `timestamptz` | written by the app on each upsert           |

  The active deck is built from the player's starter cards plus owned reward
  cards; quantities never exceed owned copies. A test match uses the saved deck
  when valid, else falls back to the starter deck.

  **RLS**: each user may `select` / `insert` / `update` / `delete` only their
  own rows (`auth.uid() = user_id`). Run once in the SQL editor:

  ```sql
  -- active_decks: a player's saved custom 30-card deck, one per faction -----
  create table if not exists public.active_decks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    faction text not null,
    cards jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- One active saved deck per user per faction.
  create unique index if not exists active_decks_user_faction_uniq
    on public.active_decks (user_id, faction);

  alter table public.active_decks enable row level security;

  create policy "active_decks_select_own"
    on public.active_decks for select
    using (auth.uid() = user_id);

  create policy "active_decks_insert_own"
    on public.active_decks for insert
    with check (auth.uid() = user_id);

  create policy "active_decks_update_own"
    on public.active_decks for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  create policy "active_decks_delete_own"
    on public.active_decks for delete
    using (auth.uid() = user_id);
  ```

  If Supabase is unavailable or unconfigured, the active deck persists to
  localStorage (per faction) instead, so the deck builder still works offline.

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
repository secrets under **Settings → Secrets and variables → Actions**:
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
