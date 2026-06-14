# @euphoria/web — Card Viewer

Public card viewer for the Euphoria TCG. Vanilla TypeScript + Vite. It reads
the card set from `data/cards/cards.json` (validated at build time with the
shared zod schema) and the art from `assets/cards/`.

## Develop

```bash
npm run web:dev      # from repo root  → http://localhost:5173
# or: npm run dev --workspace @euphoria/web
```

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
- `src/main.ts` — wiring
- `test/` — unit tests for the pure logic (data, filters, sort, detail fields)
