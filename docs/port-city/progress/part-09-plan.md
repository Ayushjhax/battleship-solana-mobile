# Part 9 — Gazette, daily puzzle and trade voyages: implementation plan

**Read:** `part-09-gazette-puzzle-voyages.md`, `00-OVERVIEW.md`, `progress/REPO-MAP.md`,
`reference/out/puzzle.md`.

**Flags:** `portCity.gazette`, `portCity.voyages`. Both default off.

---

## 0. Two findings before a line is written

### 0.1 Par 52 comes from a 20-cell fleet. This game has 18.

`reference/out/puzzle.md` ends with the sentence that matters:

> *"The fleet holds **20 cells**, so 20 of every solve are hits; everything above that is
> search."*

That is the reference's ten-ship fleet — the same one that made Part 6's `÷ 20` wrong.
This game ships **8 ships / 18 cells** (`src/engine/fleet.ts`). §2 of part-09 repeats it:
*"sink all **ten** ships"*.

So the reference's quartiles decompose as **20 hits + 32 search shots**. On an 18-cell
fleet the hit component drops by 2 outright, and the search component changes too — there
are two fewer ships to find, and the two that are gone are one-cell boats, the most
expensive targets per cell.

| | reference (20 cells) | this game (18 cells) |
| --- | --- | --- |
| best 10% | 47 | measured in §6 |
| best 25% (**par**) | **52** | measured in §6 |
| median | 57 | measured in §6 |

**What I am doing about it.** The instruction says "par 52", so **par ships as 52** — it
is a design decision, not an accident, and a rounder number than whatever the measurement
lands on. But I am not going to *assume* it still means "the best quartile":

1. `PUZZLE_PAR = 52` is a named constant, server-configurable as `puzzle.par`, never
   inlined — exactly the treatment `RAID_DESTRUCTION_DENOMINATOR` got.
2. I will run **the same measurement the reference ran** — 2,000 seeded boards, this
   repo's AI, all three difficulties — and put my table beside theirs in the report.
3. If 52 turns out to be the median rather than the best quartile, that materially changes
   what "beating par" means (from "a good solve" to "an average one", and 10 gems with it).
   I will say so plainly and leave the number at 52 unless told otherwise.

The **"Admiral's round"** threshold (§2: "under 46 is the best 10%") gets the same
treatment: shipped as written, measured, reported.

### 0.2 There is no view-shot dependency, so the image share does not ship

§1: *"exports the edition as an image **if the repo already has a view-shot dependency**;
otherwise the button is hidden. **Never add a dependency for this.**"*

There is none (`package.json` has no `react-native-view-shot`, no `captureRef`). So the
button is **hidden**, and the code path does not exist — not a disabled button.

The puzzle's emoji-grid share (§2) is unaffected and does ship: it is text, and
`expo-clipboard@~57.0.2` is already a dependency. §2 says so explicitly — *"Copy to
clipboard; no share sheet dependency needed."*

---

## 1. The Gazette

### Generation

§1: *"generated server-side on first open and then cached for the day"*, and §5.5 wants
*"the edition is stable for the whole day"*. So:

```
GET /gazette → gazette row for (user_id, today)?
                 ├── yes → return it verbatim
                 └── no  → generate, INSERT, return
```

The insert is `on conflict (user_id, date) do nothing` followed by a read, so two tabs
opening at once get the same edition rather than two.

### Templates are data, and scoring picks the page

About 40 rows of `{ id, trigger, score, slots, text }` in
`src/engine/gazette/templates.ts`. The generator takes a **day summary** the server
already has (the same facts Part 4's metric evaluator reads), runs every template's
trigger over it, and takes the highest score as the headline and the next two as
sub-stories — §1, exactly.

§1: *"Templates are localisable strings with named slots, **never concatenated
sentences**."* So a template is `"{name} downs {n} bombers with a single gun!"` and
rendering is a slot substitution, never `a + ' ' + b`. A test asserts no template
contains a `+`-built fragment and that **every template renders with every slot filled**
(§5.5).

§1's quiet day is a template with score 0 and no trigger, so it always matches — §5.5:
*"a player with no activity gets the quiet-day edition, **never an empty page**"*.

---

## 2. The daily puzzle

### Server-authoritative, and the layout never leaves

§2: *"the layout never reaches the client. Each shot is an API call that returns one
resolution."* Same structural treatment as Part 6's raid:

- `puzzle.layout` is a server-only column; there is no endpoint that returns it.
- The client holds `marks` only — the same `Marks` map a raid view carries.
- The response schema is **strict** and has no `ships`/`layout` field, so a leak is a
  parse error on the client as well as an omission on the server.
- The 500-board fuzz shape from Part 6 is reused: after every shot, the serialised
  response is grepped for an un-hit ship cell.

### One board a day, for everyone

`puzzleLayout(date)` is `autoPlaceFleet(createRng(seedForDate(date)))` — the engine's own
placer, so the board obeys no-touch by construction. §5.1's "same date, same layout;
different date, different layout" is then a property of the seed.

### One attempt, resumable

`puzzle_run` is keyed `(user_id, date)`. A shot is `update ... where finished_at is null`,
so a finished run refuses more shots (§5.2's "a second attempt on the same day is
refused") and an interrupted one simply still has its marks (the "resumable" half).

### The emoji grid

`src/engine/puzzle/share.ts`, pure: `emojiGrid(marks)` → exactly 10 lines of 10, from
`🟥 hit / 🟦 miss / ⬜ never fired`. §5.4 asserts the shape and that it matches the marks.

---

## 3. Trade voyages

### Rewards are rolled at SEND time

§3: *"rolled **server-side at send time** (so the player cannot reroll by reinstalling),
revealed on return."* So `voyage.reward` is written by `/voyage/send` and read by
`/voyage/collect` — collect never rolls. §5.6 pins it by sending, reading the row, and
asserting collect returns the same thing.

The pirate flag is rolled at the same moment and for the same reason.

### The 5×5 skirmish, and the replay

This is Part 9's most interesting problem. §3: *"The skirmish runs on the client for
speed, and the client submits the event log; the **server replays it** with the same
seeded AI and layout and refuses anything that does not reproduce."*

```
/voyage/send   → rolls pirate, stores seed + layout (server-only)
client          → plays the 5x5 locally from the same seed, collects a log of shots
/voyage/skirmish{id, log} → server replays the log against ITS layout and ITS AI
                             ├── reproduces → full cargo + 25%
                             └── does not   → HALF cargo (§3, §5.6)
```

A rejected log is **not** a zero and not an error: §3 says "Lose **or ignore it** for 24 h
→ half cargo", and a log that does not replay is indistinguishable from not playing. Half
is the honest outcome, and it removes any incentive to forge.

**The 5×5 fleet** (§3): one 3-cell, one 2-cell, two 1-cell, no-touch. That is 7 cells and
a lot of halo on 25 squares, which is why §5.7 asks for a **10,000-board legality test** —
it is not obvious the constraint is satisfiable, let alone reliably. If the generator
cannot place a board it must say so rather than emit an illegal one, and the test is what
tells us the rate.

---

## 4. Reuse

- **The board**: `GridBoard` again, at 5×5 for the skirmish via a cell-count prop, and at
  10×10 for the puzzle. No new board.
- **The engine**: `resolveCell`, `autoPlaceFleet`, `createRng`, `chooseMove` — the puzzle
  and the skirmish are the match rules on different sized boards.
- **The transport**: `src/net/featureClient.ts`, as Parts 7, 8 and 4 do.
- **The newspaper** is genuinely new drawing, but it is `Paper` + `InkPanel` + the type
  scale; no new primitives.

---

## 5. Tests (§5, all seven)

| § | File | The interesting case |
| --- | --- | --- |
| 5.1 | `tests/puzzle/puzzle.test.ts` | same date → same board; **the layout never appears in a response** |
| 5.2 | `server/tests/integration/puzzle-db.test.ts` | resume mid-solve; a second attempt refused |
| 5.3 | `tests/puzzle/puzzle.test.ts` | par and streak boundaries, and a missed day resetting |
| 5.4 | `tests/puzzle/puzzle.test.ts` | the grid is exactly 10×10 and matches |
| 5.5 | `tests/gazette/gazette.test.ts` | quiet day; scoring picks the right story; **every template renders with every slot filled** |
| 5.6 | `server/tests/integration/voyage-db.test.ts` | rewards fixed at send; **a log that does not replay pays half** |
| 5.7 | `tests/voyages/skirmish.test.ts` | **10,000 legal 5×5 boards** |

---

## 6. The measurement

`scripts/puzzle-calibration.ts`, the mirror of `reference/sim/`: 2,000 seeded boards, this
repo's AI at easy/normal/hard, reporting the same five quantiles. Its table goes in the
report next to the reference's, and it is what decides whether 52 still means what §2
says it means.

---

## 7. Risks

1. **Par may not mean what §2 says.** §0.1. Measured, reported, not silently changed.
2. **The 5×5 no-touch fleet may be tight.** §5.7 exists because of it. If the placement
   rate is poor, the generator needs a retry budget and the test will show it.
3. **Replay determinism is the whole security model for voyages.** The AI must be seeded
   and the layout server-side; if either drifts, every honest player gets half cargo. The
   test replays a *known-good* log as well as a forged one, so a false rejection fails the
   build too.
