# Mobile live-match QA (forced refresh + resume)

Manual checks for the mobile forced-reload during long live/manual matches, the
opt-in diagnostics, and Resume Match.

## Root cause (updated)

The first stability fix (capping the **rendered** battle log) helped but was not
the whole story. The dominant remaining pressure was **card-art image nodes**:
the board recreated a fresh `<img>` (re-decoding the art) for every card on the
field and in hand on **every** repaint — and the board repaints ~10× per
opponent turn. Over 15–30 turns that is thousands of image-node creations/decodes,
which is what pushes mobile Safari/Chrome to discard and reload the tab.

### Fixes in this change

- **Reuse card-art `<img>` nodes** across repaints (`artCache`, keyed by tile
  identity) instead of recreating/re-decoding them — the main memory fix. The
  cache is pruned to on-screen cards and cleared on teardown.
- **Cancel keyframe animations** before starting a new one and on `dispose()`, so
  Web Animations objects can't accumulate; attack beams are swept on teardown.
- **Low-power mode** on phones (coarse pointer + small viewport, reduced-motion,
  or `localStorage.euphoriaLowPower = "1"`): tighter rendered-log cap.
- **Resume now uses `localStorage`** (not `sessionStorage`) so the recovery
  record survives a tab being discarded and reloaded as a fresh navigation.
- **Opt-in diagnostics** capture `window.onerror` / `unhandledrejection` /
  `pagehide` / `visibilitychange` to a ring buffer that survives the reload.

## Part A — confirm the deployed build is current

1. Load the site and read the footer: `Euphoria TCG · beta · build <stamp>`.
   On a CI deploy the stamp is the 7-char commit SHA.
2. In the console: `window.__EUPHORIA_BUILD__` — should match the footer.
3. Compare to the latest commit on `master`. If it differs, GitHub Pages is
   serving a stale asset → hard-refresh / clear site data (below).
4. **Hard refresh / clear mobile cache:**
   - iOS Safari: Settings → Safari → Clear History and Website Data, or use a
     Private tab.
   - Android Chrome: ⋮ → History → Clear browsing data → Cached images and files,
     or long-press reload → "Reload (hard)".

## Part B/F — mobile repro + diagnostics

1. (Optional) enable diagnostics on the device console:
   `localStorage.euphoriaDebug = "1"` then reload.
2. Start a live match (Account → **Play match**, or Deck Builder → Play).
3. Play **20+ turns** — summon, attack, end turn through several opponent turns.
4. Expected: **no reload**; the match keeps playing.
5. Inspect diagnostics any time: `euphoriaDebugDump()` in the console returns the
   last 50 events (errors, page lifecycle, and per-paint metrics: turn, events,
   `logRows`, `artNodes`, `domNodes`, `playbackQueue`, `floaters`).
   - `artNodes` and `domNodes` should **stabilise**, not climb every turn.
   - An `error` / `unhandledrejection` entry near a reload points at a crash;
     a `pagehide` with `matchActive:true` and no following `matchEnd` points at
     the browser killing the tab (memory).
6. If a reload still happens, check whether the **Resume Match** banner appears
   on the Account page afterwards.

## Part C — Resume Match

- The match is persisted after **every** player action (seed + faction/deck +
  action list), so the latest checkpoint is always one move behind at most.
- After an interruption, the Account page shows **"Match in progress … Resume?"**
  with **Resume** (rebuilds the exact match via deterministic replay) and
  **Discard**. The save is only cleared on match end, concede, explicit discard,
  or a proven-invalid replay (never silently).
- Confirm the saved record exists: `localStorage["euphoria.activeMatch.v1"]`.

## In-app debug panel + stability toggles

With `localStorage.euphoriaDebug = "1"` a **debug panel** appears bottom-right on
the device (no devtools needed). It shows: build stamp, current view, and live
match metrics (turn, events, `logRows`, `playbackQueue`, `pendingTimers`,
`floaters`, `beams`, `domNodes`, `imageNodes`, `artNodes`), resume-snapshot
existence/size/age, last save time, last lifecycle event, and last error. Buttons:
**Copy Debug Dump** (to clipboard, falls back to console), **Force save snapshot**,
**Simulate reload check** (reports whether Resume would show), and the toggles
below. `euphoriaDebugDump()` in the console still works too.

### Stability toggles (all `localStorage`, value `"1"`)

| Flag | Effect |
| --- | --- |
| `euphoriaDebug` | Master gate: diagnostics + debug panel. |
| `euphoriaLowPower` | Tighter caps (rendered log → 25, smaller art cache). |
| `euphoriaNoAnim` | Disables Web Animations, attack beams, and float motion (state changes still shown). |
| `euphoriaNoArt` | Live battlefield uses text placeholders, no `<img>` art (detail modal art is unaffected). |
| `euphoriaNoPlayback` | Condenses opponent playback to a single callout (no step queue/timers). |
| `euphoriaNoSnapshot` | Disables resume-snapshot writes (isolate localStorage write pressure). |
| `euphoriaSafeMode` | Mobile Safe Mode: low-power + no-anim + condensed playback + throttled snapshots. |

Toggle them from the panel, or set in the console then reload.

## Controlled test matrix (Feature E)

Run each on the device, **play 20+ turns**, and record: did a reload happen? at
what turn? did Resume appear after? then `euphoriaDebugDump()` (or Copy Debug Dump).

| Test | Flags (all with `euphoriaDebug=1`) | Isolates |
| --- | --- | --- |
| 1. Normal | (none extra) | Baseline |
| 2. No animations | `euphoriaNoAnim=1` | Web Animations / beams / float motion |
| 3. No art | `euphoriaNoArt=1` | Card image decoding/memory |
| 4. No playback | `euphoriaNoPlayback=1` | Opponent playback queue/timers |
| 5. Full safe mode | `euphoriaLowPower=1` + `euphoriaNoAnim=1` + `euphoriaNoArt=1` | Combined pressure |
| 6. No snapshot | `euphoriaNoSnapshot=1` | localStorage write pressure |

If a reload **stops** under one toggle, that subsystem is the culprit — report
which test was clean. Compare `artNodes` / `imageNodes` / `domNodes` growth across
tests in the dumps.

## Known limitation

Animations and image decoding can't be measured in jsdom, so the bounded-DOM,
node-reuse, and toggle behavior are asserted structurally in tests; the actual
mobile memory profile and which subsystem triggers the reload must be confirmed
on-device with the panel + test matrix above.
