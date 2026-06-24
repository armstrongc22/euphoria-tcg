# `packages/core` Extraction Plan

Status: **PLANNED — not yet executed.** This document is the agreed plan for
extracting the DOM-free logic layer out of `apps/web/src` into a new
`packages/core` workspace, so both the existing beta (`apps/web`) and the future
React app (`apps/site`) can share one source of truth.

Nothing in this plan changes app behavior, game logic, card effects, or Supabase
behavior. It is a **source-only file move + a mechanical import rename**. The
protected engine, card-data, and Supabase/auth/reward layers are NOT touched —
see [ENGINE_LOCK.md](../ENGINE_LOCK.md).

---

## Goal & approach

Create `packages/core` (a new npm workspace, peer of `card-data` /
`game-engine`) and move the 24 DOM-free modules currently in `apps/web/src` into
it. The 16 DOM-coupled (view/shell) files stay in `apps/web`.

The package uses a **wildcard subpath export** so every move is a mechanical
rename:

```jsonc
// packages/core/package.json (proposed)
{
  "name": "@euphoria/core",
  "type": "module",
  "exports": { "./*": "./src/*.ts" },
  "dependencies": {
    "@euphoria/card-data": "*",
    "@euphoria/game-engine": "*",
    "@euphoria/simulator": "*",
    "@supabase/supabase-js": "^2.108.2"
  }
}
```

Result: every moved module's import rewrite is exactly
`from "./X"` → `from "@euphoria/core/X"`. No barrel to maintain; a 1:1 mapping.

### Why this is safe

- The 40 files in `apps/web/src` split cleanly: **24 are DOM-free** (zero
  `document` / `window` / `innerHTML` / `querySelector` usage — verified) and
  move; **16 are DOM-coupled** and stay.
- Core never imports back up into the app (moves are leaves-first).
- The only entanglement is one **type-only cycle** (`auth ↔ feedback`), resolved
  by moving both in the same batch (Batch F).
- `cards.ts` imports `../../../data/cards/cards.json`. Both `apps/web/src` and
  `packages/core/src` are depth-3 from the repo root, so `../../../` resolves to
  the root identically — the JSON import moves **unchanged**.

---

## Golden rules for execution

1. **Do not touch the protected layers** (engine, card-data, Supabase/auth/reward
   behavior). See [ENGINE_LOCK.md](../ENGINE_LOCK.md).
2. **Move, don't rewrite.** Each batch only changes file location + import
   specifiers. No logic edits.
3. **One batch = one commit.** A batch is committed **only after** its full test
   gate is green (see "Test gate" below). Each batch is a separate, atomic
   commit on a dedicated branch (e.g. `refactor/extract-core`).
4. **Green before next.** Never start a batch until the previous batch's commit
   is green.
5. **`apps/web` stays shippable** at every commit (it just imports from
   `@euphoria/core`).

---

## Extraction batches (A–F)

Batches are ordered leaves-first so the tree compiles after every batch and core
never imports app code. Each module listed moves
`apps/web/src/<name>.ts` → `packages/core/src/<name>.ts`.

| Batch | Modules | Why this layer |
|-------|---------|----------------|
| **A** | `errors`, `sort`, `filters`, `lore`, `rules`, `cards`, `starter`, `supabase-config`, `debug-log` | Zero local deps (leaves) |
| **B** | `signup`, `supabase-client` | Depend only on A |
| **C** | `rewards`, `match-recovery`, `tutorial` | Depend on A + B |
| **D** | `deck-builder`, `match`, `onboarding-checklist` | Depend on A–C |
| **E** | `match-history`, `play-match`, `match-playback` | Depend on A–D |
| **F** | `auth`, `feedback`, `pending-reward`, `progression` | `auth ↔ feedback` type cycle — move together |

**24 modules total.**

### Notes per batch

- **Batch A — `cards.ts`:** the `../../../data/cards/cards.json` import is safe
  to move unchanged (path depth is identical). `debug-log.ts` has no top-level
  DOM access (guards via `globalThis` / default params), so it is safe in core;
  it must be in core because `pending-reward` (Batch F) depends on it.
- **Batch F — `auth ↔ feedback` cycle:** `auth.ts` imports
  `type FeedbackInsert` from `feedback`; `feedback.ts` imports `type Auth` from
  `auth`. Both move in Batch F so the cycle stays internal to core (type-only,
  fine for the bundler). Do not split them across the package boundary.
- **Batch E — `play-match.ts`:** this is the live engine/AI match controller. It
  uses `@euphoria/simulator` (`smartAgent`, `buildGameResult`) and a seeded RNG.
  It is moved unchanged — determinism and the match-recovery/resume flow depend
  on it.

### Tests move with their modules

Each moved module's **unit test** moves alongside it into `packages/core/test/`
(test imports become `../src/<name>`):

```
errors, sort, filters, cards, supabase-config, signup, auth,
auth-supabase-reward, deck-builder, match, match-history, match-recovery,
match-playback, play-match, rewards, starter, tutorial, onboarding-checklist,
pending-reward, progression, feedback, feedback-auth, debug-log   (.test.ts)
```

(23 test files.)

---

## Import rewrite rule

In **any** file — app, core, or test — every `from "./X"` (and `from "../src/X"`
in tests) where `X` is a moved module becomes `from "@euphoria/core/X"`.

App files that **stay** but get imports rewritten to `@euphoria/core/*`:
`main.ts`, all `*-view.ts`, `grid.ts`, `controls.ts`, `detail.ts`,
`debug-panel.ts` (each imports moved modules such as `cards`, `auth`, `match`,
`signup`, etc.).

External imports (`@euphoria/card-data`, `@euphoria/game-engine`,
`@euphoria/simulator`, `@supabase/supabase-js`, `zod`) are package-name imports
and resolve identically from `packages/core` — no change.

---

## Files staying in `apps/web`

The DOM/presentation layer (16 modules) + app shell:

- **Shell / config:** `main.ts`, `index.html`, `vite.config.ts`, `styles.css`,
  `vite-env.d.ts`
- **Views:** `account-view`, `play-match-view`, `starter-view`,
  `deck-builder-view`, `signup-view`, `reward-view`, `rules-view`, `lore-view`,
  `match-view`, `onboarding-checklist-view`, `feedback-view`
- **Card-viewer DOM primitives:** `grid`, `controls`, `detail`
- **Diagnostics UI:** `debug-panel`, `debug-flags` (`debug-flags` is DOM-free but
  consumed only by views — no core module needs it, so it stays; can revisit
  later)
- **App-staying tests** (import a view): `account-view`, `deck-builder-view`,
  `match-view`, `play-match-view`, `signup-view`, `reward-view`, `lore-view`,
  `rules-view`, `starter-view`, `starter-choice`, `onboarding-checklist-view`,
  `feedback-view`, `debug-flags`, `debug-panel`, `detail`, `main-nav`,
  `schema-doc`, `pending-reward-integration` (`.test.ts`) — their core imports
  get rewritten to `@euphoria/core/*`.

---

## What the new `apps/site` (React) will import

`apps/site` adds `"@euphoria/core": "*"` to its deps and imports the logic layer
— **never** the engine / Supabase SDK directly:

- **Card DB / viewer:** `@euphoria/core/cards`, `/filters`, `/sort`
- **Auth & backend:** `@euphoria/core/auth` (the `createAuth()` entry — the only
  thing it needs), transitively `supabase-config` / `supabase-client`
- **Account & economy:** `/match-history`, `/rewards`, `/pending-reward`,
  `/progression`, `/onboarding-checklist`, `/feedback`
- **Deck & play:** `/starter`, `/deck-builder`, `/match`, `/play-match`,
  `/match-playback`, `/match-recovery`, `/tutorial`
- **Content:** `/lore`, `/rules`
- (`debug-log` / `errors` come transitively.)

It does NOT import `grid` / `detail` / `controls` / `debug-panel` / `*-view` —
those are rebuilt as React components.

---

## Risk level per batch

| Batch | Risk | Reason |
|-------|------|--------|
| **A** | 🟢 Low | Pure leaves; `cards` JSON path proven equivalent; `debug-log` browser-guarded |
| **B** | 🟢 Low | Two small modules, deps already in A |
| **C** | 🟢 Low | Storage / reward helpers, well-tested |
| **D** | 🟡 Medium | `deck-builder` + `match` carry deck-validation / summary logic feeding rewards & history; many app consumers |
| **E** | 🟡 Medium | `play-match` is the live engine/AI controller; determinism / recovery sensitive |
| **F** | 🟠 Higher | `auth` is the Supabase contract + the `auth ↔ feedback` cycle + most-imported module |

Overall risk is **mechanical, not logical** — no behavior changes, only file
location + import specifiers. The biggest real hazard is a *missed import
rewrite* (compile error, caught by typecheck) or a *workspace-resolution* issue
with the wildcard export (caught immediately by tests).

---

## Test gate (run after EVERY batch)

From the repo root, after **every** batch — must be green before the next, and
before committing the batch:

```bash
npm run typecheck        # cross-workspace; catches any missed import rewrite
npm test                 # full vitest run (engine + core + web)
npm run validate:cards   # card schema still parses
```

Targeted spot-checks while iterating on a batch:

```bash
npx vitest run packages/core/test   # the moved tests, in their new home
npx vitest run apps/web/test        # app tests still resolve @euphoria/core/*
```

Before declaring a batch done, also build the existing app to prove the bundler
honors the new export map:

```bash
npm run web:build
```

This mirrors the CI gate in `.github/workflows/deploy-pages.yml`
(test → typecheck → validate → build), so a green local run ≈ a green deploy.

---

## Commit discipline

- Work on a dedicated branch (e.g. `refactor/extract-core`) branched from the
  current working branch.
- **Each batch is its own commit**, made **only after** the full test gate
  (typecheck + test + validate:cards + web:build) is green.
- Commit message format, e.g.:
  `refactor(core): extract Batch A leaves into @euphoria/core`
- Never bundle two batches into one commit — atomic commits are what make the
  rollback plan work.

---

## Rollback plan

The extraction is **per-batch and git-atomic**. Make each batch one commit on a
dedicated branch, branched from the current working branch (record the baseline
SHA before starting).

1. **Per-batch checkpoint:** commit only after that batch's test gate is green.
   If a batch fails and can't be fixed quickly:

   ```bash
   git restore --source=HEAD --staged --worktree .   # discard in-progress batch
   ```

   (or `git reset --hard HEAD` to the last green commit). Previous batches remain
   intact and green.

2. **Full abort:** since nothing in `packages/{card-data,game-engine}`,
   `apps/simulator`, `data/`, or `assets/` is touched, the entire effort reverts
   with `git reset --hard <baseline-sha>`. No DB, no Supabase, no engine state is
   involved — extraction is source-only.

3. **Safety net:** `apps/web` stays fully functional throughout (it just imports
   from `@euphoria/core`), so even a partial extraction leaves a shippable beta.
   The new `apps/site` is additive and never blocks reverting.

4. **Verify a clean revert:** after any rollback, re-run
   `npm run typecheck && npm test && npm run web:build` to confirm the baseline
   is restored.

---

## Out of scope for this plan

- Creating `apps/site` (the React app) — a separate, later step.
- Any change to game logic, card effects, card data, or Supabase
  schema/auth/reward behavior.
- Deleting `apps/web` — it is retired only after `apps/site` reaches parity.
