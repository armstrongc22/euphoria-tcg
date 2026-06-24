# ENGINE_LOCK

This file declares the **protected layers** of the Euphoria TCG codebase. These
are the working rules engine, card effects, card data, and the Supabase /
auth / reward / match-record behavior. They are battle-tested and power the live
beta.

> **Do not modify any file or behavior listed here as part of the site rebuild,
> the `packages/core` extraction, or any UX/redesign work.**
>
> Changes to these layers are only permitted as their own deliberate, isolated
> task — with a stated plan and updated tests — never as a side effect of moving
> files or rebuilding the UI.

Related: the rebuild's safe-refactor plan is in
[docs/core-extraction-plan.md](docs/core-extraction-plan.md).

---

## 1. Protected: rules engine 🔒

**Directory `packages/game-engine/` — entire package, source and tests.**

| File | Role |
|------|------|
| `src/actions.ts` | `applyAction`, `getLegalActions`, all targeting helpers — legality + state-transition core |
| `src/turn.ts` | turn / phase flow, `destroyWarrior`, `opponentOf` |
| `src/status.ts` | status effects, expiry, attack restrictions |
| `src/splash.ts` | board adjacency / splash targeting |
| `src/setup.ts` | game setup (`createGame`) |
| `src/config.ts` | `DEFAULT_RULES` |
| `src/rng.ts` | seeded RNG (`createRng`, `shuffleCards`) |
| `src/events.ts` | event log types |
| `src/types.ts` | engine types |
| `src/index.ts` | public API surface |
| `test/**` (~45 spec files) | the engine contract |

The tests in `packages/game-engine/test/` are the contract. Per `CLAUDE.md`, any
rules-engine change requires an accompanying test update — and is out of scope
for the rebuild.

---

## 2. Protected: card-effect logic 🔒

- `packages/game-engine/src/effects.ts` — the `EffectRegistry` and every effect
  handler.
- The effect fields inside `data/cards/cards.json`:
  `effectCode`, `effectParams`, `effects`, `timing`.
- Effect tests: `effects.test.ts`, `group1…group6*-effects.test.ts`, and the
  named-card specs (`decimation`, `bitter-guard`, `forced-duel`, `tank-form`,
  `weapon-*`, etc.) in `packages/game-engine/test/`.

Do not change effect handlers or the effect data that drives them.

---

## 3. Protected: card data 🔒

- `data/cards/cards.json` — the card database (raw). **Never rename `spiritCost`
  or `rulesText`** in the JSON; the loader normalizes them to `cost` /
  `effectText`. Content additions are allowed only as a deliberate data task, not
  during the rebuild.
- `data/schemas/card.schema.json` — JSON schema.
- `packages/card-data/` — entire package (`schema.ts`, `loader.ts`, `paths.ts`,
  `validate.ts`, `index.ts`) — the validation contract (zod, strict).
- `assets/cards/<faction>/*.png` — card art.

---

## 4. Protected: Supabase / auth / reward / match-record behavior 🔒

The **behavior and data contract** below must be preserved exactly, even though
the modules that implement it will be relocated into `packages/core` during the
extraction (relocation only — no logic edits). See
[docs/core-extraction-plan.md](docs/core-extraction-plan.md).

### Modules implementing the contract

- `supabase-config.ts` — env detection (`VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`).
- `supabase-client.ts` — the **only** module importing `@supabase/supabase-js`;
  lazy, memoized client; anon key only.
- `auth.ts` — the `Auth` interface + the Supabase and localStorage
  implementations + `createAuth()`.
- Backend-mirror logic: `match-history.ts`, `rewards.ts`, `deck-builder.ts`
  (active-deck), `feedback.ts`, `signup.ts`, `pending-reward.ts`,
  `progression.ts`, `match-recovery.ts`.

(These currently live in `apps/web/src/`; after the extraction they live in
`packages/core/src/`. The contract is identical in either location.)

### Protected tables & columns (from `auth.ts`)

Do not rename tables, columns, payload fields, or the upsert conflict keys.

- **`profiles`** — `id`, `email`, `selected_faction`, `updated_at`
  (`created_at` is a DB default; never overwritten on update).
- **`match_history`** — `user_id`, `player_faction`, `opponent_faction`,
  `winner`, `result`, `turns`, `lives_left_player`, `lives_left_opponent`,
  `warriors_summoned_player`, `warriors_summoned_opponent`,
  `direct_attacks_player`, `direct_attacks_opponent`, `created_at`.
- **`owned_cards`** — `user_id`, `card_slug`, `card_name`, `faction`,
  `card_type`, `source`, `created_at`.
- **`reward_events`**.
- **`active_decks`** — `user_id`, `faction`, `cards`, `updated_at`;
  upsert `onConflict: "user_id,faction"`.
- **`feedback_reports`** — `user_id` (nullable for anonymous), report fields,
  `created_at` / `id` DB defaults.

### Protected behaviors

- **Auth:** email + password; email confirmation is OFF; `signUpOrSignIn`
  convenience (create, else sign in if already registered); RLS scopes each user
  to their own rows; only the anon / publishable key is used client-side
  (**never** the service_role key).
- **`getMatchStats`:** counts per result with head-only queries so totals span
  the entire history (no PostgREST row cap) — keeps the win counter climbing past
  50 games. Do not change to a row-fetch.
- **`saveReward` read-back:** after inserting `owned_cards` + `reward_events`, it
  re-selects the owned card and treats zero rows as failure (catches a missing
  SELECT RLS policy that would otherwise silently lose the reward). Preserve this
  check.
- **`resetProgression`:** user-scoped DELETE across `owned_cards`,
  `reward_events`, `match_history`, `active_decks`; surfaces a per-table error if
  a DELETE RLS policy is missing.
- **localStorage fallback:** when Supabase env vars are absent, `createAuth()`
  returns the localStorage demo backend so the static site still works. Both
  backends must stay behaviorally aligned (e.g. stats computed over all rows).
- **RLS assumptions** documented in `apps/web/README.md` (SELECT / DELETE / INSERT
  policies) are part of the contract — queries must keep matching them.

---

## 5. Protected: live match flow & AI 🔒

These DOM-free modules drive the playable match and depend on the engine + the
simulator's AI. They relocate into `packages/core` (move only, no logic edits):

- `play-match.ts` — interactive match controller; uses `@euphoria/simulator`
  (`smartAgent`, `buildGameResult`) and the seeded RNG. It re-applies saved
  actions for resume/recovery, so **determinism must be preserved** — do not
  reimplement turn-stepping elsewhere.
- `match.ts` — `summarizeMatch`, `expandStarterDeck`, seat constants; produces
  the `MatchSummary` that feeds the reward / history flow.
- `match-playback.ts`, `match-recovery.ts`, `starter.ts` (starter-deck data).

`apps/simulator/` (the `smartAgent` opponent + `buildGameResult`) is used live by
`play-match.ts` and is protected.

---

## 6. Safe to redesign (NOT protected)

For contrast — the rebuild targets these:

- `apps/web/src/main.ts` (shell / tab router), `index.html`, `styles.css`.
- All `*-view.ts` files and the card-viewer DOM primitives (`grid`, `controls`,
  `detail`) and diagnostics UI (`debug-panel`, `debug-flags`).
- The future `apps/site/` React app (greenfield).
- `_archive/`, `_incoming/`, `scripts/*.py` (legacy).

---

## Enforcement

- The test/typecheck/validate gate in `.github/workflows/deploy-pages.yml`
  (`npm test` → `npm run typecheck` → `npm run validate:cards` →
  `npm run web:build`) guards these layers on every push to `main` / `master`.
- If a rebuild task appears to require touching anything in sections 1–5, **stop
  and raise it as a separate, explicit task** with its own plan and tests — do
  not fold it into UI / extraction work.
