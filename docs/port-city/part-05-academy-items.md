# Part 5 — Naval Academy: three new arsenal items

**Depends on:** Parts 1–2 · **Flag:** `portCity.academy` · **Surface:** the rules engine, the AI, the placement shop, the battle arsenal, the server validator, the protocol

This is the part that touches the core game, so it is the part to be most careful with.
Three items, each filling a hole the current arsenal leaves, each priced inside the same
**260 fuel**. Nothing here raises a number.

**Reference:** `reference/src/resolve.ts` + `reference/test/new-items.test.ts` (16 tests)
is a working model of all three items.

---

## 1. The holes we are filling

| Hole in the current game | The new item |
| --- | --- |
| The submarine cannot be stopped by anything | **Sonar Net** — guards a column against submarines exactly as the AA gun guards a row against aircraft |
| Nothing counters mines | **Minesweeper** — sweeps two rows and disarms the mines in them |
| A defender can only ever hide, never lie | **Decoy Buoy** — reads as a hit and is not there |

## 2. Sonar Net — 10 fuel, cap 2, own board

- Placed on a free cell during placement, exempt from the halo rule like every other item.
- It guards its **entire column** for the whole match.
- When an enemy submarine tries to surface in a column holding a **live** net, the sub is
  detected: no torpedo runs, no cell resolves, the submarine is **consumed**, the
  attacker's **turn ends**, and the net's cell is **revealed to the attacker** exactly as
  an AA gun that downs a plane is (the cell is not marked, so it can still be shot).
- A net is never consumed by a detection: it can eat a submarine every time (there is only
  one submarine per match, so this matters in raids).
- Aircraft ignore nets. Nets ignore aircraft. The only interaction is with the submarine.
- A plain shot or a bomb on a live net **destroys** it: the cell is marked as an item
  wreck, the attacker keeps the turn, and the column is unguarded from then on.
- Torpedoes pass over it, like every item.
- A net inside a sunk ship's halo behaves exactly like an AA gun does today: it is
  revealed, can never be shot again, and keeps guarding. That is the known gap in
  Appendix C of the game design doc; the new item inherits it deliberately so both
  behave the same. If the team ever fixes it, fix both together.

## 3. Decoy Buoy — 5 fuel, cap 3, own board

- Placed on a free cell, but — unlike every other item — it **obeys the no-touch rule**:
  it may not sit in the 8-cell halo of one of your ships, nor touch another decoy. It is
  pretending to be a ship, so it must be placed where a ship could be.
- When it is resolved by a shot or a bomb, the attacker sees an ordinary **hit**: the cell
  is marked `hit`, and the turn (or, in a raid, the shell) continues exactly as a real hit
  would. There is no tell.
- It never sinks, so it never reveals a halo, and it never counts toward the fleet.
- A **torpedo stops on an intact decoy**, treating it as a ship cell — so a decoy can
  absorb a torpedo run and protect the ships further down the row. Once hit, it is no
  longer intact and torpedoes pass over it.
- **Radar never counts a decoy.** Radar is the honest instrument in this game, and that
  gives the attacker a way to smell one out.
- **Exposure:** the moment all **eight** of the decoy's in-grid neighbours are marked, it
  is exposed: the cell's mark changes to `decoy` and the ink shows a struck-through buoy.
  Until then the lie holds.
- A decoy cannot be "destroyed"; after it is hit it is simply a permanent phantom hit.

**Balance note (measured, not guessed).** Against a perfect parity raider the decoy is
worth about two wasted shots — see `reference/out/raid.md` section D: a bare fleet gives
up 3★ 45% of the time, +2 decoys 45%, while +3 mines drops it to 32%. That is why it is
priced at 5, the same as a mine, and capped at 3. Expect it to perform better against
humans, who over-chase a hit. If telemetry (shots spent next to exposed decoys) says
otherwise, the lever is the cap, then the price — never the rules.

## 4. Minesweeper — 15 fuel, cap 1, offensive

- You pick a row. The minesweeper sails that row **and the row below it** (picking J
  sweeps I and J, like the double torpedo).
- Every **live mine** in those two rows is disarmed: its cell is marked `mine_disarmed`,
  the mine can never trigger, and the cell can never be fired on again.
- It resolves nothing else: ships, guns, nets, decoys and radar in those rows are untouched.
- It is **not an aircraft**: no AA gun can stop it, and no sonar net either.
- **It does not end your turn.** It is the one free action in the game — the price of
  15 fuel buys safety and information, not damage. (This is the single, deliberate
  exception to §7.3 of the game design doc, and it must be written into that section.)
- It is consumed on use, whether or not it found anything.

## 5. Research

The Naval Academy researches one item at a time in its own queue (it does **not** use a
dock worker).

| Item | Academy level | Coins | Research time |
| --- | --- | --- | --- |
| Sonar Net | 1 | 1,000 | 2 h |
| Decoy Buoy | 2 | 2,500 | 8 h |
| Minesweeper | 3 | 5,000 | 1 d |
| *(reserved)* | 4–5 | — | — |

- Research can be finished early with gems using the same formula as buildings.
- An unlocked item appears in the placement shop for **every** ruleset that allows the
  arsenal — that is, Advanced only. **Classic never sees them.**
- Unlocks are stored server-side (`unlocks: string[]` on the profile) and the server
  validates every submitted layout against them: an item you have not researched is a
  rejected layout, not a silent drop.

## 6. Engine integration

Everything below is in the shared engine, used identically by the app and the server.

- New item kinds: `sonar_net`, `decoy`. New weapon kind: `minesweeper`.
- New marks: `mine_disarmed`, `decoy`. Add them to the masked view, the mark renderer and
  the protocol encoder.
- Resolution order in a cell, unchanged except for the decoy, which sits **after** the
  ship check and before the other items: already marked → live mine → ship → **decoy** →
  other live item → water.
- Interception check (before anything resolves): aircraft → live AA gun in a crossed row;
  **submarine → live sonar net in the target column**.
- Turn rule: unchanged, plus "the minesweeper never ends your turn".
- Win condition: unchanged. Decoys and nets are not ships.
- Layout validation: nets are halo-exempt; **decoys are not**; caps as in `NUMBERS.md`;
  total fuel still ≤ 260.
- Masked view: a decoy that has been hit must serialise as a plain `hit`. **There must be
  a test that fails the build if a decoy ever leaks its kind to the attacker before
  exposure** — the same spirit as the existing test that fails if an un-hit enemy ship
  appears in the payload.

## 7. The AI (doc §10)

- Offline AI keeps its fixed 100-fuel kit at Easy and Normal.
- **Hard** swaps to: Atomic 60 · Torpedo 20 · 2 × Mine 10 · Sonar Net 10 = 100 fuel, once
  the AI profile is allowed to use researched items. It never uses a submarine, so the net
  is purely defensive for it — which is correct: it punishes a player who brings one.
- The AI treats a decoy hit exactly like a real hit (it cannot tell) and drops the target
  when the cell is exposed. There must be a test that the AI never deadlocks on a decoy:
  after exposure, its target queue clears and it returns to hunting.
- The AI does not use the minesweeper in v1.

## 8. UI

- **Placement shop:** three new cards, each with the ink icon, price, cap and one line of
  Captain copy. Cards appear only when researched; before that the Academy plot advertises
  them ("Researching: Sonar Net — 1 h 12 m left").
- **Placing a net** shows its guarded column as a faint dotted line down your board, the
  same treatment the AA gun's row uses.
- **Placing a decoy** uses the ship placement preview (green/red), because it obeys the
  halo rule — this is also how the player learns that it behaves like a ship.
- **Minesweeper targeting** highlights two rows, like the double torpedo.
- Animations and sounds (follow §13.2 timings):
  - Sonar detection: a ping ring expands from the net's column, the submarine sprite
    breaks up, `sonarPing` + `subLost`, medium haptic. 900 ms total.
  - Decoy hit: identical to a normal hit. **No special sound, no special haptic** — any
    tell breaks the item.
  - Decoy exposed: the blot redraws into a struck-through buoy, `inkScratch`, 400 ms.
  - Minesweeper: a small ship crosses the two rows at 80 ms per cell (same as a torpedo),
    each mine it passes gets a "clink" (`mineDisarm`) and a crossed-out mine mark.
- **First-use tips** from the Captain, once each, in the existing tip style.

## 9. Protocol and compatibility

New marks and item kinds are breaking. Bump `PROTOCOL_VERSION`; the server refuses to
queue clients below the minimum with `upgrade-required` once `portCity.academy` is on,
and the app shows an ink "New charts available — update to sail" screen. Old clients must
never receive an unknown mark. Cover this with a test that replays a match containing all
three items against the previous protocol encoder and expects a clean refusal, not a crash.

## 10. Tests

Port every scenario in `reference/test/new-items.test.ts`, plus:

**Sonar Net** — eats a sub in its column; ignores aircraft; ignores a sub in another
column; is destroyed by a shot and stops guarding; is passed over by torpedoes; is
revealed but stays live when caught in a sunk ship's halo; never consumed by a detection.

**Decoy** — reads as `hit`; is exposed only after all eight neighbours are marked; stops a
torpedo and protects the ship behind it; is not counted by radar; cannot be placed
touching a ship or another decoy; does not affect the win condition; never leaks its kind
in the masked view; the AI does not deadlock on it.

**Minesweeper** — disarms every live mine in both swept rows and nothing else; row J
sweeps I and J; never ends the turn; is not intercepted by an AA gun; a disarmed cell is
illegal to fire on; a mine already neutralised by a halo reveal is not re-reported.

**Fuel and layout** — a layout with an unresearched item is rejected; caps are enforced;
260 is still the ceiling; everything at cap is now 360 fuel, so more must be left on the
shelf than before.

**Classic** — a Classic layout containing any of the three is rejected, and the Classic
queue is unchanged.

**Regression** — every existing engine test still passes untouched. Run the existing AI
simulation suite (if there is one) before and after and compare win rates: Normal AI vs
Normal AI should move by less than 2 points.

**Manual QA:** research each item; place a net and lose a submarine to it; place decoys
and watch a friend waste shots; sweep a row you know has mines; play one full online match
with all three researched.

## 11. Acceptance criteria

1. The three items work exactly as specified, in matches and (later) in raids, with the
   server as referee.
2. No existing rule changed except the one documented exception (the minesweeper is a free
   action), and §7.3 of the game design doc is updated to say so.
3. A decoy is indistinguishable from a real hit until it is exposed, proven by a test on
   the serialised masked view.
4. Classic is untouched; unresearched items cannot be submitted; old clients cannot see
   new marks.
