# Part 3 — Shipyard and Stationer's Shop: implementation plan

**Status:** plan only. No implementation code written yet.
**Read:** `part-03-cosmetics.md`, `00-OVERVIEW.md`, `progress/REPO-MAP.md`.

---

## 0. Blocker: Parts 1 and 2 still do not exist

`part-01-report.md` and `part-02-report.md` were on the read list. **Neither exists, and no
Part 1 or Part 2 code has been written.** I have now produced three plans and zero
implementation, because Parts 1 and 2 each ended with "stop and show me the plan" and the
go-ahead never came. Verified just now:

```
docs/port-city/progress/   REPO-MAP.md, part-01-plan.md, part-02-plan.md
src/engine/city/  src/city/  server/src/city/   none exist
supabase/migrations/                            0001…0013, no 0014
git status                                      clean but for the planning docs
```

Part 3 is "Depends on: Parts 1–2". That dependency is **not uniform** — roughly 60% of this
part stands on the shipped codebase and can be built today:

| Buildable **now** (touches only shipped code) | Blocked on Part 1 / Part 2 |
| --- | --- |
| The cosmetic catalogue as pure data | `POST /cosmetics/buy`, `/equip` (needs Part 1's `server/src/city/`, flags, `requestId` log, `city_apply`) |
| **Contrast + mark-distinguishability tests** | `cosmetics_owned` / `cosmetics_equipped` persistence (needs the 0014 migration and the city transaction) |
| Render hooks in `src/board/*` for all six slots | The two shop **sheets** (need Part 2's plots and sheet chrome) |
| Unknown-effect fallback resolver | Shelf gating by store level (needs Part 1's `CITY_CATALOGUE` levels) |
| Sink-effect timing test | |
| `cosmetics` in the match payload (protocol) | |
| `GemStore` adapter + `NotAvailable` | |
| The Captain's Desk preview screen | (reachable from the shops, which are blocked — but the screen itself is standalone) |

I have not started either half, because "build the endpoints" would mean inventing Part 1's
server scaffolding inline, and that is a different part shipping under this one's name. **See
the question at the end — I need one decision from you before I write code.**

Everything below is complete and executable either way.

---

## 1. Three things I have to report before building, per the hard rule

The instruction was explicit: *"If any cosmetic changes a hitbox, a duration that matters or
an information boundary, stop and report instead of shipping it."* Three do.

### Finding A — a 600 ms sink effect **would** delay the turn flip

`part-03` §3 permits sink effects up to **600 ms** and says they "must not delay the turn
flip". In this codebase those two clauses contradict each other.

`EventPlayer` is strictly serial — "per event, in order: await the animation, then commit"
(`src/fx/EventPlayer.ts:1-14`). The relevant waits today:

```ts
case 'SUNK':                                   // src/fx/battleEffects.ts:152-164
  deps.commit(event); playSfx('shipSink'); haptic('sink');
  await player.wait(420);                      // <- the whole sink budget
  return;

case 'TURN_CHANGED':                           // src/fx/battleEffects.ts:197-200
  deps.commit(event);
  await player.wait(TURN_FLIP_MS);             // 180 ms, dequeued AFTER the sink
  return;
```

`TURN_CHANGED` is a separate event dequeued *after* `SUNK` finishes. So the turn flip already
sits **420 ms** behind a sink, and any cosmetic effect longer than 420 ms pushes it further.
A 600 ms effect would add 180 ms to every sink in every match — a duration that matters.

**What I will ship instead:** every sink effect declares a `durationMs`, the catalogue is
capped at **≤ 420 ms**, and the test asserts (a) every effect ≤ 420, and (b) the total awaited
time in the `SUNK` branch is **identical whichever effect is equipped**. That satisfies "never
delays the turn flip" literally. I am not implementing the 600 ms allowance.
`part-03-cosmetics.md` §3 needs its "≤ 600 ms" corrected to "≤ 420 ms" — I will do that and
note it in the report.

### Finding B — Ghost fleet's "slow drift" is an information-boundary risk

§2 describes Ghost fleet as "existing masks at 45% alpha with a dashed overlay and **a slow
drift**". §1 says the opponent sees your hull set "where the rules already make your ships
public" — i.e. only `sunkShips` and `revealedItems` from `projectView()`.

A drift animation is harmless on a wreck. It is a **leak** if it is ever attached to a ship
the opponent has not proven, because motion on an otherwise-empty cell tells them a ship is
there. `projectView()` never sends enemy ship positions, so the leak cannot come from data —
but it can come from the renderer if the hull cosmetic is applied at the board level rather
than per-sunk-wreck.

**What I will ship:** the opponent-side hull cosmetic is applied **only** inside the
`wrecksOf(...)` path in `app/(game)/battle.tsx:68-82`, never to `GridBoard`'s `ships` prop,
and a test asserts an enemy board with a cosmetic equipped renders exactly the same node count
for unsunk cells as with the default. The existing `src/engine/__tests__/view.test.ts` grep
(which CLAUDE.md says to keep green whenever `PlayerView` grows) is extended to the new
`cosmetics` field.

### Finding C — the contrast rule as written does not save the most expensive item

I computed WCAG contrast for all 48 ink × paper pairs. **13 fail the 3:1 floor.** The
distribution is the interesting part:

```
ink           graph  parchment  blueprint  dotted  seachart  squared
violet         8.88       7.50       1.28    8.72      6.90     8.60
crimson        6.77       5.72       1.67    6.65      5.26     6.56
forest         4.86       4.11       2.33    4.77      3.78     4.71
sepia          5.72       4.83       1.98    5.61      4.44     5.54
charcoal      11.08       9.36       1.02   10.88      8.61    10.73
teal           4.80       4.05       2.36    4.71      3.73     4.65
rust           4.86       4.10       2.33    4.77      3.77     4.70
gold           2.51       2.12       4.51    2.47      1.95     2.43
```

§3's remap says "anything under 3:1 is remapped to that ink's **light** variant on dark papers
(Blueprint)". That fixes the Blueprint column — 7 failures, all dark-ink-on-dark-paper.

It does **not** fix Gold, which fails on **all five light papers** (1.95–2.51) and passes only
on Blueprint. Gold is the 350-gem premium item, so as specified the most expensive cosmetic in
the game is unreadable on the default paper. The rule is one-directional and misses it.

**What I will ship:** the remap becomes bidirectional — each ink declares `base`, `onDark` and
`onLight` variants, and the resolver picks by paper luminance, not by a Blueprint special
case. Gold's `onLight` is a darker antique-gold that clears 3:1 on every light paper; its
`base` stays the bright gold used on cards, chips and the Captain's Desk swatch. The test then
asserts **every** pair ≥ 3:1 after remap, which is the real acceptance criterion in §7.2.

> Paper colours are a number the doc does not give — it names six papers and prices them but
> specifies no hex. The values above are my proposal and go in `DECISIONS.md`. Graph is the
> existing `color.paper` token; the other five are new.

None of the three findings is a gameplay effect, a hitbox change or a rule change — they are a
duration, a renderer scoping rule and a legibility rule. So the answer in each case is "ship
the corrected version and record it", not "stop the part".

---

## 2. Render hooks — the six slots

One context, read by the board renderer, defaulted so that **nothing changes when the flag is
off or nothing is equipped**.

```ts
// src/cosmetics/render.ts  (pure)
export interface RenderConfig {
  inkPalette: { ink: string; inkSoft: string; inkFaint: string; inkRed: string };
  paper: PaperSpec;                    // background + rule colours + rule style
  pen: { strokeWidth: number; roughness: number; bowing: number; alpha: number };
  hullSet: HullSetId;
  sinkEffect: SinkEffectId;
  victoryStamp: StampId;
}
export const DEFAULT_RENDER_CONFIG: RenderConfig;      // === today's look, byte for byte
export function resolveRenderConfig(equipped, paperId): RenderConfig;  // applies the contrast remap
```

| Slot | Hook point | Change |
| --- | --- | --- |
| Fleet ink | `src/board/art.ts` — `markPaths(state, seed)` | → `markPaths(state, seed, palette)`. It currently hardcodes `color.ink` / `inkRed` / `inkFaint` at 9 sites |
| Pen | `src/board/art.ts`, `ShipSprite` | the `RoughOpts` `strokeWidth` / `roughness` / `bowing` come from `pen` instead of `ROUGH_DEFAULTS` |
| Paper | `src/ui/Paper.tsx` | rule colours and background from `PaperSpec`; the memoised `<G>` of rules is unchanged structurally |
| Hull set | `src/board/ShipSprite.tsx` | already takes `stroke?` and `sunk?`; gains `hullSet?` selecting the path generator |
| Sink effect | `src/fx/battleEffects.ts` `case 'SUNK'` | effect id selects the visual; **the awaited time is a constant** (Finding A) |
| Victory stamp | `app/(game)/result.tsx` | the win ribbon's glyph |

**Whose cosmetics apply where** — the rule that keeps the boundary honest:

- Your own board: your full config.
- Enemy board: your `paper` and your `pen`/`ink` for **your marks on their board** (your shots
  are yours to style), and **their** ink/pen/hull only on `sunkShips` and `revealedItems`.
- Their sink effect plays on your screen when **they** sink one of **your** ships.

`resolveRenderConfig` is pure and takes both players' cosmetics, so this is table-testable
without a renderer.

---

## 3. Server, payload and the protocol

- `GET /cosmetics` → `{ catalogue, owned, equipped }`, catalogue server-driven so a season can
  add items without an app update (§5).
- `POST /cosmetics/buy {itemId, requestId}` → `already-owned`, `not-enough-coins`,
  `not-enough-gems`, `locked-tier`, `feature-off`.
- `POST /cosmetics/equip {slot, itemId, requestId}` → `not-owned`, `bad-slot`.

Both reuse Part 1's `requestId` replay and `city_apply` transaction — **this is the blocked
half.** Storage is two JSONB columns on the city row (`cosmetics_owned`,
`cosmetics_equipped`) rather than new tables, so buy/equip stays inside the single city
transaction and the existing optimistic-version retry covers it.

**The match payload.** `cosmetics` rides the existing `matched` frame at arena reveal:

```ts
// server/src/protocol.ts — additive field on an existing message
| { t: 'matched'; v: 1; matchId: string; you: OpponentSummary; opponent: OpponentSummary;
    mode: MatchMode; fuelBudget: number; layoutDeadline: number;
    wagered: boolean; wagerStake: number;
    cosmetics?: { you: EquippedSet; opponent: EquippedSet } }   // NEW, optional
```

`EquippedSet` is six string ids. **No positions, no counts, nothing derived from a board** —
that is the §3 requirement and a test asserts the serialised frame matches
`/^[a-z0-9_.-]+$/` per slot and carries no numeric coordinate field.

The protocol is marked FROZEN and is **hand-mirrored** in `src/net/protocol.ts` (CLAUDE.md:
"the two are kept in lockstep by hand"). The field is optional and additive, so an old client
ignores it and a new client tolerates its absence — which is also test 4's fallback path.
Both files move in the same commit.

---

## 4. Catalogue

`src/cosmetics/catalogue.ts` — one exported table, same shape and checksum discipline as
Part 1's `CITY_CATALOGUE`.

Items exactly as §2 lists them: 8 inks (Gold at 350 gems), 6 papers, 5 pens, hull sets
(Standard / Ghost fleet / Paper boats + 3 reserved art-dependent slots), 4 sink effects,
4 victory stamps. Prices from §2's ranges; `tier` per item drives the shelf gate.

Reserved art-dependent sets (Ironclad, Longship, Junk) ship as catalogue entries with
`available: false` so the shelf can show them as "Coming soon" without a client update when
the art lands — the same pattern as the `NotAvailable` gem store.

---

## 5. Tests (§6 in full)

| # | Test | File | Needs |
| --- | --- | --- | --- |
| 1 | buy → own → equip → appears in the match payload; second buy refused, refunds nothing | `server/tests/integration/cosmetics.test.ts` | Part 1 |
| 2 | cannot equip un-owned; a forged client payload is ignored — the **server** builds the render config | `server/tests/integration/cosmetics.test.ts` | Part 1 |
| 3a | **contrast ≥ 3:1 for all 48 ink × paper pairs after remap** | `tests/cosmetics/contrast.test.ts` | — |
| 3b | **mark distinguishability**: miss/hit/sunk/revealed/mine mutually distinct on every paper | `tests/cosmetics/marks.test.ts` | — |
| 4 | unknown effect / hull / stamp id → default, no throw (simulated old client) | `tests/cosmetics/fallback.test.ts` | — |
| 5 | **every sink effect ≤ 420 ms, and the awaited total is identical per effect** | `tests/cosmetics/sinkTiming.test.ts` | — |
| 6 | a level-1 store never returns tier-2 items as buyable | `server/tests/integration/cosmetics.test.ts` | Part 1 |
| 7 | enemy board node count unchanged for unsunk cells with any hull set (Finding B) | `tests/cosmetics/boundary.test.ts` | — |
| 8 | `DEFAULT_RENDER_CONFIG` reproduces today's look exactly; flag off ⇒ no cosmetic code path runs | `tests/cosmetics/flagOff.test.ts` | — |

**3b in detail**, since it is the one that could be hand-waved: `markPaths` returns
`PathInfo[][]` with explicit `stroke` / `fill` / `strokeWidth`. The test reduces each mark to
a feature vector — (dominant stroke colour, fill colour, total path length, bounding box,
layer count) — and asserts that on each paper, every pair of the five marks differs on at
least two axes **and** that each mark's stroke clears 3:1 against that paper. That catches the
real failure (mine and hit both going red-on-parchment and becoming one blob) without needing
a renderer, which this repo does not have in its test setup.

All client tests land in `tests/cosmetics/`, covered by the existing `tests/**/*.test.ts`
glob — **no `vitest.config.ts` change**.

---

## 6. Files

**Added:** `src/cosmetics/{catalogue,render,contrast,types,fallback}.ts`,
`src/cosmetics/GemStore.ts` (interface + `NotAvailable`), `src/cosmetics/ui/CaptainsDesk.tsx`,
`src/cosmetics/ui/ShelfSheet.tsx` (Shipyard + Stationer's, one component, two catalogue
filters), `server/src/city/cosmetics.ts` (blocked half), `tests/cosmetics/*`.

**Touched:** `src/board/art.ts` (palette + pen params), `src/board/ShipSprite.tsx` (hull set),
`src/ui/Paper.tsx` (paper spec), `src/fx/battleEffects.ts` (sink effect selection, constant
wait), `app/(game)/result.tsx` (victory stamp), `app/(game)/battle.tsx` (wreck-scoped enemy
hulls), `server/src/protocol.ts` + `src/net/protocol.ts` (the additive `cosmetics` field, in
lockstep), `src/engine/__tests__/view.test.ts` — **extended, not weakened**, to cover the new
field, exactly as CLAUDE.md instructs.

No existing test is deleted or weakened.

---

## 7. Assets

Part 3 needs **no new images** — inks, papers, pens and the two implemented hull sets are all
procedural over the existing stroke generator. The three reserved hull sets (Ironclad,
Longship, Junk) are the only art-dependent items, and they ship as `available: false` until a
real illustrator draws them; that is §2's own framing and needs no placeholder art.

**Sound:** one new key, `inkStamp`, for the victory stamp. Sink effects reuse the existing
`shipSink`. As always a `null` source is silent, so this is not a blocker.

See the note at the end on what I would actually ask you to generate.

---

## 8. Risks

1. **Parts 1–2 absent.** The blocked half cannot be honestly built without inventing them.
2. **`markPaths` is load-bearing.** It is used by every mark on both boards; threading a
   palette through it touches the hottest render path in the game. Mitigated by keeping the
   signature backward-compatible (`palette` defaults to today's tokens) and by test 8.
3. **The protocol is frozen and hand-mirrored.** Two files, no compiler link between them.
   Mitigated by an additive optional field and a test that round-trips a `matched` frame
   through both encoders.
4. **Rough path cache pressure.** `roughCore` caches by `(shape, dims, seed, opts)` with a
   1,200-entry LRU. Pen cosmetics change `opts`, so each equipped pen is a **new cache
   population** — switching pens on the Captain's Desk could thrash it. Mitigated by
   previewing on a 4×4 mini board rather than a full 10×10, and by a cache-size assertion.
5. **Gold-on-light** (Finding C) — fixed by the bidirectional remap, but it means the shop
   must show the *remapped* swatch, not the base, or players will buy a colour they never see.

---

## 9. Order of work

1. `contrast.ts` + `catalogue.ts` + tests 3a/3b — the legibility rules first, because they
   constrain the palette everything else uses.
2. `render.ts` + `DEFAULT_RENDER_CONFIG` + test 8 (prove today's look is unchanged).
3. Render hooks: `art.ts` → `ShipSprite` → `Paper` → `battleEffects` → `result`.
4. Tests 4, 5, 7 (fallback, timing, boundary).
5. Protocol field, both sides, + the `view.test.ts` extension.
6. `GemStore` + `NotAvailable`, Captain's Desk.
7. **Blocked half** once Part 1 exists: endpoints, persistence, shelf gating, tests 1/2/6.
8. Shop sheets once Part 2 exists.
