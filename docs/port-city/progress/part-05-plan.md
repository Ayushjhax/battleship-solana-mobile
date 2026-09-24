# Part 5 — Naval Academy and three new arsenal items: implementation plan

**Status:** plan only. **The engine has not been touched.**
**Read:** `part-05-academy-items.md`, `00-OVERVIEW.md`, `NUMBERS.md`, `CORRECTIONS.md`,
`progress/REPO-MAP.md`, `reference/src/resolve.ts`, `reference/test/new-items.test.ts`.

Reference suite re-run before planning: **80/80 pass** (resolve 26, new-items 16, raid 17,
city 21).

---

## 0. Why this part is different

Parts 1–2 added a new subsystem beside the game. This one reaches into
`src/engine/`, which the app and the match server share and which 477 of the 550 app tests
stand on. A mistake here is not a broken screen — it is a wrong shot resolution in a live
ranked match, on both clients at once, with the server agreeing.

So the plan below is organised around **one question: how do I prove nothing else moved?**
That is §7, and I would rather you read that section than any other.

---

## 1. Two naming decisions I need from you

`part-05` §6 and your instruction both spell the new kinds **snake_case**:
`sonar_net`, `decoy`, `minesweeper`, and marks `mine_disarmed`, `decoy`. The reference
implementation uses snake_case throughout because that is *its* convention.

**This repo does not.** Every existing value in both unions is camelCase or a single
lowercase word:

```ts
export type ArsenalKind =
  | 'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber'
  | 'aaGun' | 'radar' | 'mine' | 'submarine';            // src/engine/types.ts:47

export type CellState = 'unknown' | 'miss' | 'hit' | 'sunk' | 'revealed' | 'mine';  // :73
```

`aaGun`, not `aa_gun`. So `sonar_net` would be the only snake_case member of a union whose
other seven members are camelCase, in a type that is serialised on the wire, keyed in
`ARSENAL_SPEC`, switched on in `applyEvent`, and used as a CSS-ish key in `markPaths`.

**My recommendation: `sonarNet`, `decoy`, `minesweeper`, and marks `mineDisarmed`, `decoy`.**

- Cost of following the doc literally: a permanently mixed union, and every future reader
  wondering which convention applies to the next item.
- Cost of my recommendation: the doc and the reference spell them differently from the
  code. Mitigated by a note in `part-05-academy-items.md` §6 and in the report.

**I will not start the engine until you pick.** Everything below is written with the
camelCase names; a swap is mechanical if you prefer the doc's spelling.

The second, smaller decision: **`decoy` is both an item kind and a mark.** That is the
doc's design and it is fine — they live in different unions — but it means
`markPaths(state)` and `specFor(kind)` both accept the string `'decoy'` meaning different
things. I will keep them distinct in code by never widening a function to take
`CellState | ArsenalKind`.

---

## 2. Engine: exactly what changes

### 2.1 `src/engine/types.ts`

| Change | Detail |
| --- | --- |
| `ArsenalKind` | `+ 'sonarNet' \| 'decoy' \| 'minesweeper'` |
| `CellState` | `+ 'mineDisarmed' \| 'decoy'` |
| `MatchEvent` | `+ SUBMARINE_DETECTED { playerId, netAt }`, `+ MINE_DISARMED { playerId, at }`, `+ DECOY_EXPOSED { playerId, at }`, and `MINESWEEPER_RUN { playerId, rows, path }` |
| `ArsenalItem` | unchanged — `revealed`/`destroyed`/`used` already carry everything the net and decoy need |

`AIRCRAFT_DOWNED` is **not** reused for the submarine: it names a `kind` that is an
aircraft and the UI switches on it. A separate event keeps the two animations independent
and keeps the old event's meaning intact.

### 2.2 `src/engine/arsenal.ts`

| Function | Change |
| --- | --- |
| `ARSENAL_SPEC` | three rows: `sonarNet` 10/cap 2/own board, `decoy` 5/cap 3/own board, `minesweeper` 15/cap 1/offensive/target `'row'` |
| `intercept()` | stays exactly as-is — it is the **aircraft** rule |
| **new** `interceptSubmarine()` | mirrors `intercept()`: finds a live `sonarNet` whose `at.c === target.c`, marks it `revealed`, returns `keepsTurn: false`. Deliberately a sibling, not a generalisation, so a change to one cannot silently change the other |
| `submarine()` | calls `interceptSubmarine()` before resolving anything |
| **new** `minesweeper()` | `doubleTorpedoRows(row)`, then for each live `mine` in those rows: `used = true`, `revealed = true`, mark `mineDisarmed`. Returns `keepsTurn: true` **always** |
| `torpedo()` | stops on an intact decoy as well as an intact ship — one extra clause in the existing `hasIntactShipAt` check |
| `radar()` | unchanged, and that is the point: it counts `ships` only, so it already never counts a decoy. **A test pins this**, because a future refactor that switched it to "occupied cells" would silently break the item |

The `ARSENAL_SPEC` total at cap becomes 20·2 + 35·2 + 30·2 + 60 + 10·3 + 15 + 5·5 + 10 +
**10·2 + 5·3 + 15** = **360**, against the unchanged 260 budget. `CORRECTIONS.md` §2
predicted exactly this.

### 2.3 `src/engine/shots.ts` — the one place resolution order changes

`resolveCell` today is: already-marked → live mine → ship → other live item → water.
§6 inserts the decoy **after the ship check and before other items**:

```
already marked -> live mine -> ship -> DECOY -> other live item -> water
```

The decoy branch marks the cell `'hit'` — *not* `'decoy'` — and returns
`{ hit: true, sunk: false, mine: false }`, which is byte-identical to what a real ship-cell
hit returns. That identity is the whole item.

**Exposure** is a separate sweep, run after every resolution: a hit decoy whose eight
in-grid neighbours are all marked flips its mark to `'decoy'` and emits `DECOY_EXPOSED`.
The reference does this in `exposeDecoys(board)`; I will port it as a private helper called
from `resolveCell`'s tail so nothing can forget to call it.

> **Note against the reference.** `reference/src/resolve.ts:59` says *"A decoy is exposed
> once every **orthogonal** neighbour it has is marked"* in its comment, while the design
> doc (§3) and its own test (`'is exposed only once all eight neighbours are marked'`) say
> **eight**. The doc and the test win; I will implement eight and flag the stale comment.

### 2.4 `src/engine/placement.ts`

`validateArsenalPlacement` currently exempts every item from the halo rule. The decoy is
the exception: it must additionally fail if its cell is in any ship's `halo()` or adjacent
to another decoy. One new branch, guarded on `item.kind === 'decoy'`, so nothing else
changes behaviour.

### 2.5 `src/engine/match.ts`

- `useArsenal`'s `switch` gains a `minesweeper` case.
- The `aaGun | mine` "works on its own" guard gains `sonarNet` and `decoy`.
- `afterAttack`'s turn rule is unchanged; the minesweeper's `keepsTurn: true` flows through
  it untouched. **This is the single documented exception to §7.3** and it lives in the
  weapon, not in the turn rule — so the turn rule itself is provably unmodified.
- `validateSubmission` gains an `unlocks` parameter (§3 below).

### 2.6 `projectView` — the secrecy boundary

Two rules, and a test that fails the build for each:

1. `revealedItems` filters on `i.revealed || i.destroyed`. A **hit decoy is neither** — it
   is `used`-ish but not revealed — so it never enters that array. An **exposed** decoy
   does become `revealed` and may appear, because by then the player can see it.
2. The enemy `marks` object carries `'hit'` for an un-exposed decoy, which is exactly what
   a real ship cell carries.

The existing `src/engine/__tests__/view.test.ts` greps the enemy half of every view for
ship coordinates. I will extend it, not replace it, to also grep for the string `'decoy'`
in any view where a decoy has been hit but not exposed.

---

## 3. Server: unlocks, research, validation

### 3.1 Storage

`profiles.unlocks text[]` (default `'{}'`), guarded by `guard_profile_update` like every
other server-owned column — a client that could write its own unlocks could field an
unresearched item. Migration `0016_academy.sql`.

Research state lives in the **city row**, not a new table: `CityState.research`
`{ itemId, startedAt, endsAt } | null`. §5 says the Academy "researches one item at a time
in its own queue (it does **not** use a dock worker)", so `freeWorkers()` is not consulted
and `busyWorkers()` does not count it — which is the one thing that could accidentally
couple this to Part 1's worker economy.

Research costs and times come from §5's table, which is **not** in `NUMBERS.md`. I will add
them to `CITY_CATALOGUE` as an `ACADEMY_RESEARCH` table and extend the existing
`catalogueChecksum()` and the NUMBERS.md cross-file pin to cover them — or, if you prefer,
add the table to `NUMBERS.md` first. **Flagging rather than choosing.**

### 3.2 Endpoints

`POST /city/research/start {itemId, requestId}` and `/city/research/finish {requestId}`
(gems, same `speedUpGems` formula as buildings, per §5). Typed errors reuse Part 1's union
plus `already-researching`, `already-unlocked`, `needs-academy`.

### 3.3 Layout validation

`validateSubmission(mode, ships, arsenal, unlocks)`:

- **Classic rejects all three**, and in fact already rejects *any* arsenal
  (`match.ts:147-150`), so Classic needs no new code — only a test proving it.
- Advanced rejects an item whose kind is in the new set but not in `unlocks`, with a typed
  reason. §5: "a rejected layout, not a silent drop".
- Caps and the 260 ceiling are unchanged code paths.

The server passes the player's unlocks from the profile it already loads for
`fetchOpponentSummary`; the offline/hot-seat path passes the locally cached unlocks, which
is the same trust level as today's offline results.

---

## 4. AI, UI, protocol

### 4.1 AI (`src/engine/ai.ts`)

- **Hard** gains the §7 kit: Atomic 60 · Torpedo 20 · 2× Mine 10 · Sonar Net 10 = 100 fuel.
  Easy and Normal keep today's kit **byte-for-byte** — that is what makes the regression in
  §7 meaningful.
- The AI reads only `PlayerView`, so it *cannot* tell a decoy hit from a real one, which is
  correct and needs no code.
- **Deadlock is the real risk.** The AI's TARGET mode queues neighbours of an unresolved
  `'hit'`. A decoy is a hit that never sinks, so without a change the AI would chase it
  forever. Fix: treat a `'decoy'` mark as resolved, and — because exposure only happens
  once all eight neighbours are marked — the queue drains naturally. A test asserts the AI
  returns to HUNT after exposure, and the existing 40-seed simulation would hang if it did
  not.

### 4.2 UI

Placement shop cards (three, researched-only), the net's guarded-column dotted line (the
AA gun's row treatment, rotated), decoy placement through the **ship** preview because it
obeys the halo rule, two-row minesweeper targeting like the double torpedo.

**The decoy hit must have no tell.** Same `playSfx('explosion')`, same `haptic('hit')`, same
burst, same 320 ms — the animation path must not branch on `decoy` at all. The cleanest way
to guarantee that is for `battleEffects.ts` to never see a decoy: the engine already emits
a plain `HIT` event for it. I will assert that no new event type is emitted on a decoy hit.

New sounds: `sonarPing`, `subLost`, `inkScratch`, `mineDisarm` — four keys on the closed
`SFX_SOURCES` union, `null` (silent) until files exist. See §9.

### 4.3 Protocol

`PROTOCOL_VERSION` is currently **inert** — declared 1 in both files, never sent, never
compared (REPO-MAP §5). So "bump it" means building the mechanism first:

1. `hello` gains optional `protocol: number` (absent ⇒ 1).
2. The server stores it on the connection.
3. `queue` refuses when `portCity.academy` is on and `protocol < MIN_PROTOCOL (2)`, with a
   new typed `ErrorCode` `'upgrade_required'`.
4. The client maps it to an ink "New charts available — update to sail" screen.

Gating on the flag is what makes this safe: with `portCity.academy` off, every existing
client keeps working exactly as today. `ArsenalKindSchema` in both protocol files gains the
three kinds, in lockstep.

---

## 5. Files

**Added:** `src/engine/__tests__/newItems.test.ts`, `.../decoySecrecy.test.ts`,
`.../regression-winrate.test.ts`, `src/city/ui/ResearchSheet.tsx`,
`server/src/city/research.ts`, `supabase/migrations/0016_academy.sql`,
`tests/city/research.test.ts`.

**Touched:** `types.ts`, `arsenal.ts`, `shots.ts`, `placement.ts`, `match.ts`, `ai.ts`,
`board/art.ts` (two marks), `fx/applyEvent.ts` + `battleEffects.ts` (three events),
`features/arsenal/ShopPanel.tsx` + `BattleArsenal.tsx`, both `protocol.ts` files, `ws.ts`,
`audio/index.ts`, `part-05-academy-items.md` §6, plus the game design doc (§7.3 and
Appendix A — see §8).

---

## 6. Tests

Every scenario from `reference/test/new-items.test.ts` (all 16, listed in §10 of the design
doc) ported into `src/engine/__tests__/newItems.test.ts`, plus:

| Test | Why |
| --- | --- |
| **decoy secrecy** | serialise `projectView` for a board with a hit-but-unexposed decoy and assert the JSON contains no `'decoy'` anywhere, and that the cell reads `'hit'`. Fails the build on a leak |
| **Classic rejection** | a Classic layout with any of the three is rejected |
| **unlocks** | an unresearched item is a rejected layout, not a silent drop |
| **360 at cap** | the spec table sums to 360 against a 260 budget |
| **AI never deadlocks** | after exposure the target queue drains and the AI hunts again |
| **radar still ignores decoys** | pins the behaviour §3 depends on |
| **minesweeper is free** | `keepsTurn` true, and `afterAttack` does not change `turn` |
| **old-client refusal** | a `hello` without `protocol` cannot queue while academy is on, and gets `upgrade_required` rather than a crash |

---

## 7. How I will prove no existing rule changed

This is the section that matters.

1. **The 477 existing app tests and 181 server tests run untouched.** Not one line of an
   existing test may change. If one must, it stops being a regression check and I will stop
   and tell you instead.
2. **A win-rate regression harness**, `regression-winrate.test.ts`. The repo already has
   `src/engine/__tests__/simulation.test.ts` running 40 seeded AI-vs-AI games through the
   real reducer. I will extend that shape to **500 seeded Normal-vs-Normal games** and
   record the win rate for seat 0.
   - Run it on `HEAD` **before** any engine change and commit the number into the test as a
     literal.
   - The same 500 seeds must land within **2 points** of it afterwards (§10's bar).
   - Normal AI's kit is unchanged and it never fields the new items, so the only way this
     moves is if an existing rule moved. That is precisely the signal wanted.
3. **A resolution-order golden test**: `resolveCell` against a board with a mine, a ship, an
   AA gun and water, asserting the same outcomes as today — so inserting the decoy branch
   provably did not reorder anything else.
4. **`ARSENAL_SPEC` checksum**: the existing eight rows are pinned by value, so a typo in
   an existing price fails immediately rather than shifting balance quietly.

I will run step 2's "before" number **first**, as the very first commit of the part, so the
baseline cannot be contaminated.

---

## 8. Design-doc updates you asked for

- **§7.3** gains the minesweeper exception, written as a rule rather than a footnote:
  "One rule covers every weapon — with one deliberate exception: the Minesweeper never ends
  your turn." `CORRECTIONS.md` §7 already anticipated this.
- **Appendix A**'s "everything at cap costs 310 fuel" becomes **360**, with the working
  shown. `CORRECTIONS.md` §2 already predicted the number.
- `part-05-academy-items.md` §6 gains a note on the camelCase naming (§1 above), if you
  accept that recommendation.

---

## 9. Assets

**No images.** All three items are ink sprites from the existing stroke kit, in the style of
the current arsenal icons.

**Four sounds**, all new keys on the closed `SFX_SOURCES` union — `null` is silent, so
nothing is blocked:

| Key | What | Length |
| --- | --- | --- |
| `sonarPing` | a single submarine sonar ping, clean and cold | ~0.6 s |
| `subLost` | a hull groaning and imploding, distant and underwater | ~0.9 s |
| `mineDisarm` | a small metallic clink, a mine going safe | ~0.25 s |
| `inkScratch` | a pen scribbling something out, fast and angry | ~0.4 s |

ElevenLabs **Sound Effects** (text-to-SFX) is the right product — it does audio, not images.
Settings as before: *prompt influence* 0.7–0.8 (literal foley), *duration* pinned not
automatic, 3–4 takes and keep the driest, WAV → **mono 44.1 kHz MP3** to match
`assets/audio/sfx/`.

- `sonarPing` — "single active sonar ping, clean sine sweep, long tail, underwater, no music"
- `subLost` — "distant submarine hull groaning and imploding underwater, muffled, low frequency"
- `mineDisarm` — "small metallic clink of a latch closing, dry, close mic, no reverb"
- `inkScratch` — "ballpoint pen scribbling out a word quickly on paper, close mic, dry"

**Timing constraint:** §8 puts the whole sonar detection at **900 ms** and the decoy
exposure at **400 ms**, so `sonarPing` + `subLost` must fit inside 900 ms together and
`inkScratch` inside 400 ms. Pin the durations rather than letting the model choose.

---

## 10. Order of work

1. **Baseline the win rate** (§7.2) and commit the number. Nothing else in the same commit.
2. Types and `ARSENAL_SPEC` — no behaviour yet; both suites must stay green.
3. `shots.ts` decoy branch + exposure sweep, with the golden resolution-order test.
4. `interceptSubmarine`, `minesweeper`, torpedo-stops-on-decoy, placement halo rule.
5. Port all 16 reference tests; then the secrecy and Classic tests.
6. **Re-run the win-rate harness.** If it has moved ≥ 2 points, stop and find out why
   before writing a line of UI.
7. Server: unlocks column, research queue, layout validation.
8. Protocol version gate + `upgrade_required`.
9. AI Hard kit and the anti-deadlock rule.
10. UI: shop cards, column indicator, decoy preview, two-row targeting, animations.
11. Design-doc updates, report with before/after numbers.

---

## 11. Open questions for you

1. **Naming** (§1): camelCase `sonarNet`/`mineDisarmed` as I recommend, or the doc's
   snake_case?
2. **Research numbers** (§3.1): §5's table is not in `NUMBERS.md`. Add it there first, or
   let me put it in `CITY_CATALOGUE` and extend the checksum?
3. The two Part 3 rulings (Gold ink, Ghost fleet) are still open and unrelated to this part,
   but they will block Part 3 whenever it comes round.
