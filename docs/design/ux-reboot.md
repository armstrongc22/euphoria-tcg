# Euphoria UX Reboot — Design & Implementation Concept

Status: concept approved for Phase A + a Monk-only Phase B slice (2026-07-02).
Scope guard: presentation layers only — engine, effects, card data, auth,
Supabase/rewards/deck validation, PvP sync, and the 2D map/notation system are
all out of bounds (see ENGINE_LOCK.md).

## 1. UX architecture

**One mental model: "Universe Hub, not website."** The public site is a hub
with three destinations — **Play** (the beta), **World** (map + lore),
**Manga** (story + founder/Kickstarter/shop). The homepage is a set of portals
into those three, styled like a game's main menu.

- **apps/site** keeps its router and pages; this is a re-skin + re-hierarchy,
  not an IA rewrite. `Home` becomes the hub; `Play` / `MapPage` / `Manga` /
  `Shop` / `Cards` / `Blog` become destinations with a shared "channel"
  identity (accent + panel treatment each).
- **apps/web (game client)** stays single-screen and structurally untouched.
  The reboot is an **effects layer** subscribed to events the board already
  fires — additive CSS/WAAPI, zero board-logic edits.
- **Map** becomes three modes behind the existing `MapModeSwitcher`: **2D**
  (default, unchanged), **Notation** (unchanged), **3D Flight** (new,
  read-only over the same marker data).
- **State boundaries frozen**: auth gate, Supabase contracts, deck validation,
  engine. The reboot lives in `*-view.ts`, CSS, site components, and one new
  3D module.

## 2. Visual design direction

**"Premium manga broadcast."** Marvel-vs-Capcom-class energy — dark stage, one
loud accent at a time, diagonal cuts, kinetic type — delivered with manga
discipline (ink blacks, screentone textures, clean gutters). No borrowed IP,
logos, characters, or UI.

- **Base palette:** near-black stage, off-white ink text, thin silver
  hairlines. Color is *earned* — it only appears as faction energy.
- **Faction energy** is the single expressive system, reusing the map's
  `FACTION_COLORS` palette: Dwarf green earth/metal, Monk red impact/flame,
  Surfer blue flow, Sonic yellow lightning, Shaman purple aura, Human bronze
  tactical, Neutral silver glow, Criminal black/shadow glitch. One custom
  property (`--fx-energy` at use sites, `--eu-energy-*` tokens) drives glows,
  panel edges, beams, and accents across site and game.
- **Diagonal panel language:** one global angle token (≈7°) for section
  dividers, cards, CTAs; panels overlap slightly like manga frames breaking
  their gutters.
- **Type:** one heavy display face for shout moments (SUMMON / VICTORY /
  section titles — italic, skewed) over one quiet body face.
- **Texture:** low-opacity screentone dots / speedline gradients on hero and
  section backgrounds.
- **Restraint rule:** at most one animated hero element per screen.

## 3. Main screens / components

### Public site
- **Nav/header:** slim dark bar; wordmark left; Play / World / Manga center;
  faction-silver **Play Beta** button with energy edge right; compresses to a
  hairline on scroll. Mobile: bottom-sheet menu of three large diagonal panels.
- **Homepage hero:** full-viewport dark stage, key art / map vignette behind a
  diagonal light sweep, wordmark + one line, two CTAs (**Play the Beta**,
  **Explore the World**); slow 8s faction-color cycle on the edge glow
  (reduced-motion: off).
- **Beta promo:** diagonal split — arena screenshots in tilted cabinet frames
  with faction glow · "Playable now" copy + live-chip + CTA.
- **Map/world:** the real interactive map embedded, perspective-tilted, 3–4
  markers glowing; CTA "Enter the World Map". Doubles as the 3D mode's teaser.
- **Manga:** ink-first panel crops + screentone; the calmest section on the
  page (premium contrast).
- **Founder/Kickstarter:** diagonal founders-wall banner; status chip, founder
  benefits, email capture (existing waitlist plumbing), Kickstarter follow.
  Silver→gold accent (milestone, not faction).
- **Shop teaser:** honest dark card row — "Volume 1 · Coming soon" + notify.
- **Mobile:** single column of full-bleed diagonal panels in the same order;
  map section becomes a static teaser image (perf).

### Game client (all additive)
- **Ephemeral FX nodes** appended to the board root (the pattern the attack
  beam already uses; `paint()` replaces children every frame, so effects are
  short-lived and self-cleaning — no persistent overlay).
- **Big-moment banner** (later): diagonal slash banner for SUMMON / DIRECT HIT
  / VICTORY; the existing callout stays as the accessible text.
- **Selected-card treatment:** stronger faction-colored edge glow on the
  existing `--selected` classes; **valid-target pulse** strengthens the
  existing `--target` class.
- **Attack prompt & reward reveal re-skins** (later): dark stage, diagonal
  header, energy edges; reward reveal = silhouette flash → card slam.
- **Turn-change transition:** ≤520ms diagonal energy wipe in the newly-active
  side's faction color.

## 4. Motion / effects system

**One subscriber, thirteen verbs, eight palettes.** The board dispatches
`MATCH_ANIM_EVENT` CustomEvents (`{ kind, actor, targetInstanceId,
targetPlayer }`, kinds: draw/summon/play/equip/attack/damage/heal/buff/debuff/
destroy/revive/directAttack/info) on the board root for every resolved moment.
The FX layer is one module (`apps/web/src/match-fx.ts`) that listens and maps:

- `kind` → effect template: summon (ground-burst ring), attack (impact flash),
  damage/heal (floater styling), destroy (shatter/ink-dissolve), revive
  (rising glow), directAttack (seat impact + edge flash), buff/debuff (motes),
  draw/play/equip/info (micro-feedback only).
- actor's faction → `--eu-energy-*` palette. **Faction modifiers skin shared
  templates** (Dwarf slabs/short shake · Monk flame lick + impact frame ·
  Surfer liquid arcs · Sonic afterimage/jitter · Shaman distortion bloom ·
  Human bronze tracer · Neutral plain silver · Criminal 2-frame glitch).
- Discipline: CSS keyframes (auto-run on insert, jsdom-safe) or the existing
  `playAnim()` WAAPI wrapper; `prefers-reduced-motion` respected; the existing
  `euphoriaNoAnim` / low-power flags gate the whole layer; ≤400–520ms per
  effect; hard cap on concurrent FX nodes; effects never block input and are
  wiped by the next paint at worst.
- Tokens (colors, durations, easings, diagonal, glow) are shared CSS variables
  (`fx-tokens.css`) between site and arena so hub and game feel like one
  product.

## 5. 3D map — technical approach

Follow the path `MapPreview3D.tsx` documents: Three.js via `@react-three/fiber`
+ `drei`, added **only to @euphoria/site**, dynamic-imported behind the mode
switch so 2D users download nothing.

- **Data:** the 2D notation map stays the single source of truth. 3D reads the
  same `MapMarker[]` through `imageToNormalizedCoords` →
  `normalizedToThreeCoords`; the schema's existing optional `elevation`,
  `markerHeight`, `view3d.{enabled,scale,labelOffsetY}` fields are the 3D
  authoring surface (editable in notation mode today, no schema change).
- **Scene v1:** base-map PNG textured on a plane; faction-colored pins
  (pole + billboard glyph) with a small idle bob; click/tap → the existing
  lore card as a DOM overlay (not in-canvas).
- **Flight camera:** orbit + dolly with soft bounds; "flight" feel from
  inertia + banking (not a true sim). **Reset camera** and **Return to 2D**
  as fixed HUD buttons. Desktop drag/wheel (+optional WASD); mobile one-finger
  orbit, pinch zoom, two-finger pan.
- **Terrain later:** grayscale heightmap displacement on the same plane.
- **Fallbacks:** existing `detectWebGL()` gate; no WebGL / reduced-motion /
  low-power ⇒ the current CSS-tilt preview, unchanged.
- **Later layers:** route trails (tube geometry through waypoints), faction
  territory overlays (translucent authored texture).

## 6. Prototype first

1. **Game FX slice:** `match-fx.ts` + summon burst, attack flash, damage/heal
   popups, selected glow, target pulse — **Monk-tuned** end-to-end.
2. **Homepage hero + nav re-skin** (establishes tokens everything reuses).
3. **3D flight spike:** textured plane + 5 pins + orbit + return-to-2D behind
   the WebGL gate; measure fps + bundle delta before committing further.

## 7. Do not touch

- `packages/game-engine`, effects, `cards.json`, simulator (ENGINE_LOCK).
- `play-match.ts`, `match.ts`, `match-playback.ts` contracts; PvP sync layer.
  The FX layer *listens*; it never emits or reorders game events.
- Auth/Supabase/rewards/deck-validation modules and tables; the auth gate.
- Board DOM structure/logic in `play-match-view.ts` beyond attaching the FX
  layer; the mobile-stability work (art cache, log caps, animation caps).
- The 2D map, notation mode, marker schema semantics, curated marker data.
- Beta routing/screens in `apps/web/src/main.ts`.

## 8. Phased plan

| Phase | Scope | Risk |
|---|---|---|
| A. Foundation tokens | Shared CSS tokens in site + arena; visually inert | none |
| B. Game FX layer | match-fx subscriber + verbs (selected/target → summon/attack/damage → destroy/revive/direct → turn wipe → reward reveal); Monk first, then 7 palettes; reduced-motion/low-power gated | low |
| C. Site hub re-skin | nav/hero → beta promo → world → manga → founders → shop; mobile bottom-sheet | low |
| D. 3D Flight v1 | Three.js behind dynamic import + WebGL gate: plane, pins, lore overlay, reset/return, touch | medium |
| E. 3D layers + polish | heightmap, trails, territory overlays, map-entry cinematic; modal re-skins | medium, optional |

Each phase ships independently and reverts cleanly; B and C parallelize;
nothing blocks the live beta.
