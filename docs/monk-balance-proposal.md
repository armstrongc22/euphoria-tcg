# Monk Balance Proposal

**Status:** Package A+B accepted and merged for beta; Package C deferred.
**Date:** 2026-06-14 (proposed) · 2026-06-15 (decision)
**Source:** simulator instrumentation (`sim:balance`, `sim:trace`, `sim:monk-compare`) + `data/cards/cards.json` stat analysis.

> Scope guardrails for any implementation of this doc: do **not** change deck
> construction; treat card-effect edits (Package C's `7th-plague`) as a
> separate, isolated change with its own rules-engine test.

---

## Decision (2026-06-15)

- **Package A + B accepted for beta** and merged to `master` (commits
  `481b4e6` Package A, `78c4368` Package B). Sim result: Monk faction win
  ~39% → ~43% (≈44% vs the field), no overshoot, best–worst spread narrowed
  16.5 → 12.0 pts.
- **Package C deferred** — Monk is now competitive vs Surfer/Sonic, so the
  broader C buffs risk overshooting them.
- **Further Dwarf/Monk balance deferred until after public beta feedback.**
  The residual gap is mostly the Dwarf matchup (~36%); investigating whether
  Dwarf is the real outlier is parked, not abandoned.
- This is a **beta supporting the IP/manga, not a tournament-balanced final
  release** — "good enough for beta" was the bar, and A+B clears it.
- **Next milestone: card viewer / website.**

---

## 1. Problem statement

Greedy mirror sims across all faction matchups put Monk well below the field,
and the deficit survives smarter play:

| Agent | Monk overall win | as P1 | as P2 |
|---|---|---|---|
| greedy | 38.3% | 45.3% | 31.3% |
| smart | 40.3% | 46.0% | 34.7% |

Worst matchup: **vs Dwarf ~33%**, and it does **not** move under the smarter
agent (33.5% → 33.0%). The Monk mirror is symmetric (~65% P1 under both
agents — pure first-player advantage), confirming the gap is **not** an
AI/policy artifact, not deck construction (identical recipe for every
faction), and not a rules issue (rules affect all factions equally).

**Loss pattern (40-seed probe, Monk perspective):** Monk summons ~the same
number of bodies (~6.7) but **loses more of them** (~5.0 vs opp ~4.3) and lands
**fewer direct attacks** (~1.2 vs opp ~1.9). It loses the *attrition race* in a
combat model where the attacker takes no counter damage, so its board is
cleared first and the opponent closes out with direct attacks.

**Root cause: intrinsic card power.** Monk warriors are the most expensive
(avg cost 1.81) and least stat-efficient.

---

## 2. Data: Monk vs the field

**Field norms** (Surfer/Dwarf/Sonic warriors), by cost:

| Cost | ATK | HP |
|---|---|---|
| 1 | 2000 | 6630 |
| 2 | 2425 | 6533 |
| 3 | 2789 | 6289 |

**Monk deficits vs those norms:**

- **cost-1 HP −490** (avg 6143 vs 6630) — cheap bodies die a hit sooner.
- **cost-2 HP −533, ATK −55** (6000/2370 vs 6533/2425).
- **cost-3: ATK −114 but HP +711** — Monk's expensive bodies are tanky but
  weak-hitting, and Monk runs **four** of them (highest avg cost → slowest
  development).
- **Attack cards: 3** (`7th-plague`, `dantes-lamentation`, `gylippus`) vs
  Dwarf/Sonic's 4.

**Worst-tuned Monk warriors (the levers):**

| slug | cost | ATK | HP | note |
|---|---|---|---|---|
| `hideon` | 1 | 1800 | 5500 | below both cost-1 norms |
| `oog` | 1 | 1850 | 5500 | below both cost-1 norms |
| `haifa-morningstar` | 2 | 2350 | 5500 | lowest cost-2 HP |
| `hades-ceru` | 3 | 2550 | 6500 | weakest cost-3 attacker → cost-cut candidate |
| `emo` | 3 | 2600 | 6500 | weak cost-3 attacker → cost-cut candidate |

---

## 3. Packages

### Package A — Conservative (2 cards; ATK + HP)

| Card | Change | Type |
|---|---|---|
| `hideon` | 1800/5500 → **2000/6000** | ATK +200, HP +500 |
| `oog` | 1850/5500 → **2000/6000** | ATK +150, HP +500 |

- **Why:** fixes the two cost-1 bodies that sit *below both* norms — the
  warriors that lose the earliest free trades, feeding the attrition gap.
  Brings them to the cost-1 ATK norm and toward the HP norm.
- **Expected impact:** **+1 to +3 pts** (Monk ~39–41%). Floor-raising minimum;
  does not close the gap.
- **Overbuff risk:** ~none — both cards stay at/below field norms.
- **Test:** `validate:cards` → `npm test` → `sim:balance --games 300 --seed 123`
  before/after; compare Monk faction win + the three Monk matchups.

### Package B — Moderate (4 cards; A + HP + one cost cut) — **recommended start**

Everything in A, plus:

| Card | Change | Type |
|---|---|---|
| `haifa-morningstar` | 2350/5500 → **2350/6200** | HP +700 |
| `hades-ceru` | cost **3 → 2** (keep 2550/6500) | **COST** |

- **Why:** `haifa` is the weakest cost-2 HP — +700 lifts it to the cost-2 norm
  so mid-curve bodies survive a trade. The **`hades-ceru` cost-3→2** is the key
  lever: it attacks the "overcosted" root directly (Monk drops 4 → 3 cost-3
  bodies, improving tempo) and yields a *fair* cost-2 (ATK/cost 1275 vs norm
  1212; HP 6500 ≈ norm 6533) — not a blowout.
- **Expected impact:** **+4 to +7 pts** (Monk ~43–46%). The cost cut drives most
  of it.
- **Overbuff risk:** moderate, concentrated in `hades-ceru` as a cost-2. Clean
  single-card rollback: revert to cost-3 or trim its HP.
- **Test:** A's protocol + `sim:monk-compare --seeds 100` (both seats/agents) +
  `sim:trace` on a few Monk-vs-Dwarf games to confirm Monk survives attrition.
  Gate: Monk ≤ ~50%, mirror ~50/50, no faction below ~42%.

### Package C — Aggressive (B + broad HP + 2nd cost cut + 1 Attack-card buff)

Everything in B, plus:

| Card | Change | Type |
|---|---|---|
| `xian` | HP 6000 → **6500** | HP |
| `huoyan-ying` | HP 5500 → **6200** | HP |
| `warden-arcane` | HP 6000 → **6500** | HP |
| `emo` | cost **3 → 2** (keep 2600/6500) | **COST** |
| `7th-plague` | AoE `amount` 1000 → **1500** | **ATTACK-CARD / effect number** |

- **Why:** normalizes HP across the cheap/mid curve (survive attrition
  outright), cuts a **second** cost-3 → cost-2 so Monk's curve matches Surfer's
  lean shape (only 2 cost-3), and strengthens Monk's signature AoE so it
  punishes the go-wide boards (Dwarf/Sonic) that out-tempo it — closing the
  Attack-card gap in *power* rather than count.
- **Expected impact:** **+8 to +12 pts** (Monk ~46–50%+). Most likely to reach
  parity — and most likely to overshoot.
- **Overbuff risk:** **high.** Stacking board-wide HP + two cost-2 conversions +
  a 50%-stronger AoE can push Monk above the field; because win rates are
  relative, it also depresses the others. Expect to peel items back.
- **Test:** full battery, then **iterate**: if Monk > ~52% or any faction <
  ~40%, roll back the highest-impact items one at a time (order: `7th-plague`
  amount → `emo` cost) and re-run.
- **Note:** `7th-plague` is the only change touching effect data
  (`effectParams.amount`) — isolate it and add a rules-engine test for the new
  AoE value.

---

## 4. Shared testing protocol

- **Relativity caveat:** the 4 faction win rates sum to 100%, so buffing Monk
  *necessarily* lowers the others. **Target Monk ~48–50%, not >52%**, and judge
  success by the narrowing best-vs-worst spread, not Monk's number alone.
- **Pipeline per package:** `npm run validate:cards` → `npm test` →
  `npm run sim:balance -- --games 300 --seed 123` (Monk faction + per-matchup +
  seat split) → `npm run sim:monk-compare -- --seeds 100` → spot-check with
  `npm run sim:trace`. Re-run on a **second seed** (e.g. `--seed 777`) to avoid
  tuning to one RNG stream.
- **Guardrails:** mirror stays ~50/50; Dwarf (current ceiling) doesn't crater
  below ~45%; avg turns don't collapse (run-away aggression).

---

## 5. Recommendation

Minimal-first: **implement Package A, measure, then escalate to B only if the
gap persists.** A isolates the cheap-body fix so its sensitivity is readable
before adding the cost-cut. Expectation: **B is the sweet spot** (the cost-cut
is where the real movement is); **C overshoots** and should be treated as a
menu to draw 1–2 items from if B underdelivers, not a wholesale change.

All estimates are hypotheses to confirm empirically — nothing here is final
until a sim run validates it.
