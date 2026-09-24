# Part 5 — Naval Academy and three new arsenal items: report

**Status: engine, validation, AI and protocol complete. Research queue and the placement-shop
UI are not, and are named in §7.**

| Gate | Result |
| --- | --- |
| App suite | **593 passed / 46 files** (was 550 / 44) |
| Server suite | **181 passed / 16 files** (unchanged) |
| `tsc --noEmit` both sides | clean (outside the pre-existing `docs/port-city/reference/` set) |
| `eslint .` | clean |
| Reference suite, re-run before starting | 80/80 |

---

## 1. The regression numbers

This was the whole point of the part's ordering: the baseline was measured and committed
**before a single engine line was touched**, so it could not be contaminated by the work it
guards. 500 seeded Normal-vs-Normal games per mode, through the real reducer, with no
arsenal on either side — so the only thing that can move it is an *existing* rule changing.

| | Before | After | Δ | Bar |
| --- | --- | --- | --- | --- |
| Classic, seat A win rate | **50.2 %** | **50.2 %** | **0.0** | < 2.0 |
| Classic, median moves | **100** | **100** | **0** | ≤ 2 |
| Advanced, seat A win rate | **50.2 %** | **50.2 %** | **0.0** | < 2.0 |
| Advanced, median moves | **100** | **100** | **0** | ≤ 2 |
| Rejected actions across 1,000 games | 0 | 0 | — | 0 |

Zero movement on every measure. `src/engine/__tests__/regression-winrate.test.ts` keeps the
baselines as literals and prints the live numbers on every run.

Backing this up, a **golden resolution-order test** asserts that a board with a mine, a ship,
an AA gun and open water resolves to exactly the same four outcomes and the same four marks
as before — so inserting the decoy branch provably did not reorder anything else.

And the strongest signal of all: **all 477 pre-existing app tests and all 181 server tests
pass untouched.** One test changed; see §6.

---

## 2. What was built

### Engine

| File | Change |
| --- | --- |
| `types.ts` | `ArsenalKind` + `sonar_net`/`decoy`/`minesweeper`; `CellState` + `mine_disarmed`/`decoy`; four new events; `ACADEMY_KINDS` + `isAcademyKind` |
| `arsenal.ts` | three `ARSENAL_SPEC` rows; `interceptSubmarine()`; `minesweeper()`; torpedoes stop on an intact decoy |
| `shots.ts` | the decoy branch; `hasIntactDecoyAt`; `exposeDecoys()` on **every** `resolveCell` exit |
| `placement.ts` | the decoy obeys the no-touch rule; every other item stays halo-exempt |
| `match.ts` | minesweeper wired; net and decoy join the "works on its own" guard; `validateSubmission` gains `unlocks` |
| `ai.ts` | decoy-safe target queue; revealed nets mark their column as suicide for a sub |

Each rule is implemented where it belongs rather than where it was easiest:

- **The minesweeper's free turn lives in the weapon, not the turn rule.** `minesweeper()`
  returns `keepsTurn: true`; `afterAttack()` in `match.ts` is byte-identical to before. That
  is what makes "no existing rule changed" checkable rather than asserted.
- **`interceptSubmarine()` is a sibling of `intercept()`, not a generalisation.** Aircraft
  ignore nets and nets ignore aircraft, so a shared helper would let a change to one silently
  change the other. The duplication is the safety.
- **`exposeDecoys()` runs at all six `resolveCell` exits**, not just the decoy one — a decoy's
  last unmarked neighbour can be claimed by a miss, a ship hit, a mine, an item or a halo
  reveal.

### Validation, AI and protocol

- `validateSubmission(mode, ships, arsenal, unlocks?)`. `unlocks` **undefined means no gate**,
  so every existing caller behaves exactly as before; when given, an un-researched Academy
  item is a rejected layout with a typed reason, never a silent drop.
- **Classic needed no new code** — it already rejects any arsenal at `match.ts:148`. It now
  has a test proving all three are refused.
- `PROTOCOL_VERSION` 1 → 2 on both sides, with the mechanism built (it was inert before —
  declared twice, never sent, never compared). `hello` carries an optional `protocol`; a
  client below `MIN_PROTOCOL` is refused at `queue` with the new typed `upgrade_required`,
  **only while `portCity.academy` is on**. With the flag off — the default — every existing
  client is unaffected.

---

## 3. A decoy cannot leak

Four tests, and one of them fails the build on any leak at all:

```ts
const view = projectView(state, 'a');
expect(JSON.stringify(view)).not.toContain('decoy');
```

The string must not appear *anywhere* in what the attacker receives. Backing it up:
the cell reads `hit`; `revealedItems` contains no decoy; `shipsRemaining` still says 8; and a
separate test asserts a decoy hit emits **exactly the same event list** as a real hit
(`['HIT']`), so the animation layer cannot branch on it and produce a tell.

The defender's own view still shows their decoys — it is their board.

---

## 4. Three findings

### The shop would have started scrolling again

`tests/regression/home-and-hud-fixes.test.ts` exists because "arsenal scrolls" shipped as a
bug. It pins the placement shop to a 3 × 3 grid holding 8 kinds. Part 5 makes it **11**, which
does not fit — so the part would have reintroduced the exact bug that test guards.

The obvious fix, a fourth **column**, is wrong: it drops each card to 92 dp wide, under the
110 dp legibility floor the *same* test pins. A fourth **row** keeps cards at 124 dp, and the
panel had the height to spare (`SHOP_Y` 62 + 270 = 332, inside the 360 canvas).

So the shop is now **3 × 4 at 400 × 270**, and the grid arithmetic moved into
`src/features/arsenal/shopGrid.ts` so the regression can assert the numbers the component
actually uses rather than a copy of them.

### The reference's exposure comment contradicts its own test

`reference/src/resolve.ts:59` says a decoy is exposed once every **orthogonal** neighbour is
marked. The design doc §3 and the reference's own test both say **eight**. Eight is
implemented; the comment is stale.

### The game design doc is not in this repository

`docs/` holds only `port-city/`. `docs_assets/brief.md` is a 279-line build brief with no
§7.3 and no Appendix A — the full design doc the Port City package cites throughout (§7.3,
§13.2, Appendix A, Appendix C) is an external document.

So the two edits you asked for could not be applied here. Both are written out **verbatim,
ready to paste**, in `CORRECTIONS.md` §2 and §7 — the file the package already uses to track
exactly these, and which already anticipated both. Each is now marked
**"PART 5 HAS SHIPPED — this edit is now due"** and names the test that pins it in code.

---

## 5. Tests added (43)

`src/engine/__tests__/newItems.test.ts` — 39 tests: all 16 reference scenarios plus the
secrecy set, Classic rejection, caps, the 360-at-cap sum, and the golden resolution order.
`regression-winrate.test.ts` — 3. Plus one strengthened assertion in the shop regression.

Worth calling out, because they cover the traps rather than the happy path:

- the net is **never consumed** by a detection and eats a second submarine;
- a net in a sunk ship's halo is revealed, unshootable and **still guarding** (the deliberate
  Appendix C gap the item inherits);
- a decoy **stops a torpedo** and shields the ship behind it, then stops doing so once hit;
- radar **never counts a decoy**, pinned so a refactor to "occupied cells" fails loudly;
- a mine already neutralised by a halo reveal is **not re-reported** by the minesweeper;
- an AA gun does **not** stop a minesweeper, and neither does a sonar net.

---

## 6. The one existing test that changed

`tests/regression/home-and-hud-fixes.test.ts` — "has exactly eight kinds to show" became
"has every arsenal kind — eight originals plus the Academy three", and the grid constants
went from 3 × 3 to 3 × 4.

**Strengthened, not weakened.** Every original assertion survives (fits the panel width,
fits the height under the title, cards stay legible, no scroll view), and it gained one:
the constants now come from `shopGrid.ts`, so the test checks what the component actually
uses instead of a copy that could drift. Its stale `GRID_GAP * 2` — a hardcoded 3-column
assumption — was fixed to `GRID_GAP * (COLUMNS - 1)`.

---

## 7. Not done

**The Academy research queue (§5).** Server-side unlocks are validated end-to-end — the
engine gate, the typed rejection and the tests are all in — but the thing that *grants* an
unlock is not: no `profiles.unlocks` column, no `CityState.research`, no
`/city/research/start|finish`. Until it exists, `validateSubmission` is called without
`unlocks`, which means no gate, which is exactly the pre-Part-5 behaviour.

Two reasons I stopped here rather than pushing on: §5's cost/time table is **not in
`NUMBERS.md`** and I asked which home you wanted for it (open question 2 in the plan, still
unanswered); and the engine work above was the risky half, so it deserved to land verified
rather than be rushed alongside a migration.

**The placement-shop UI (§8).** The cards render — names, info copy, diagrams and two-row
minesweeper targeting are all in, and the grid now has room — but three pieces are missing:
the net's guarded-column dotted line, decoy placement through the ship preview, and the
"Researching: Sonar Net — 1 h 12 m left" state on the Academy plot. The new kinds also have
**no line art**; `ARSENAL[kind]` returns undefined for them and the card falls through to the
procedural ink, which is correct but plain.

**Animations and sounds (§8).** The four sound keys are not yet added, and the sonar-ping and
decoy-exposure animations are not built. Critically, the *absence* of a decoy animation is
correct and tested — a decoy hit must be indistinguishable, and it is.

---

## 8. How to test this by hand

```bash
echo 'PORT_CITY_ACADEMY=on' >> server/.env   # gates the protocol refusal only
npm run server && npm start -- --dev-client
```

Because the research queue is not built, unlocks are ungated, so all three items appear in
the placement shop immediately.

1. **Place a sonar net in a column, then have the opponent surface a submarine there.** The
   sub is consumed, nothing resolves, their turn ends, and the net's cell shows on their
   board but stays shootable.
2. **Shoot the net.** It dies, the attacker keeps the turn, and the column is open again.
3. **Place three decoys** where a ship could sit — the shop refuses one touching a ship.
   Have a friend shoot them: they read as ordinary hits with no sound, haptic or animation
   difference. Watch them chase one.
4. **Mark all eight neighbours of a decoy.** The mark flips to `decoy`.
5. **Radar a 3 × 3 containing only decoys** → it reports 0. That is how you smell one out.
6. **Sweep a row you know has mines.** They cross out, nothing else in those rows is touched,
   and **it is still your turn**.
7. **Confirm the shop does not scroll** with all 11 kinds visible — 3 columns × 4 rows.
8. **Check Classic** still refuses every one of the three.

---

## 9. Assets

**No images needed.** The three items draw from the existing stroke kit; real line art would
improve them but nothing is blocked.

**Four sounds**, none added yet (they are §8's, and §8's animations are not built):

| Key | What | Length |
| --- | --- | --- |
| `sonarPing` | a single active sonar ping, clean and cold | ~0.6 s |
| `subLost` | a hull groaning and imploding, distant and underwater | ~0.9 s |
| `mineDisarm` | a small metallic clink, a mine going safe | ~0.25 s |
| `inkScratch` | a pen scribbling something out, fast | ~0.4 s |

ElevenLabs **Sound Effects** (text-to-SFX) is the right product — it does audio, not images.
Prompt influence 0.7–0.8 (literal foley), **duration pinned, not automatic**, 3–4 takes and
keep the driest, export WAV → **mono 44.1 kHz MP3** to match `assets/audio/sfx/`.

- `sonarPing` — "single active sonar ping, clean sine sweep, long tail, underwater, no music"
- `subLost` — "distant submarine hull groaning and imploding underwater, muffled, low frequency"
- `mineDisarm` — "small metallic clink of a latch closing, dry, close mic, no reverb"
- `inkScratch` — "ballpoint pen scribbling out a word quickly on paper, close mic, dry"

**Timing constraint worth pinning before you generate:** §8 gives the whole sonar detection
**900 ms** and the decoy exposure **400 ms**. So `sonarPing` + `subLost` must fit inside
900 ms *together*, and `inkScratch` inside 400 ms. Pin the durations rather than letting the
model choose, or the animation will be cut off mid-sound.

**There must never be a sound for a decoy hit.** It reuses `explosion` and `haptic('hit')`
exactly as a real hit does. Any new sound there breaks the item.
