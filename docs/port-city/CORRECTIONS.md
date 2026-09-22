# Corrections and findings for the existing game design doc

Found while building the reference implementation of the current rules. Each one is
either verified by a passing test in `reference/` or by a simulation in `reference/out/`.

### 1. The auto-reveal example undercounts, or rather overcounts (doc §5.2)

The worked example says a sunk destroyer on C3–C4 hatches **twelve** cells. The halo of a
1 × 2 ship is **ten**: the box around it is 3 × 4 = 12 cells, two of which are the ship
itself. The engine behaviour is almost certainly right; the caption is counting the box.
Verified in `reference/test/resolve.test.ts` ("the last cell sinks the ship and hatches the
whole halo"). Fix the caption, or check the engine if it really reveals twelve.

### 2. "Everything at cap costs 310 fuel" is correct — and becomes 360

40 + 70 + 60 + 60 + 10 + 15 + 30 + 25 = 310 today. With the three Part 5 items it becomes
360 against the same 260 budget, so the shelf gets harder to choose from, which is the
point. Update Appendix A when Part 5 ships.

### 3. Hard may not be much harder than Normal

Doc §10.2 says Hard "wastes far fewer shots around wrecks". In 2,000 simulated boards the
reference AI cleared a board in a median of **57 shots at Normal and 57 at Hard**
(`reference/out/puzzle.md`). The reason is that the auto-reveal already hatches every halo
cell for free, so the main deduction Hard adds is one the rules perform anyway. If the
shipped engine behaves the same, Hard is mostly a label. If you want a real Hard, the next
step is probability-density targeting (score every legal remaining ship placement per cell)
rather than more exclusion rules — and note that four single-cell boats are what actually
make a board expensive to clear.

### 4. The AA-gun-in-a-halo gap is now load-bearing

Appendix C notes that a live AA gun inside a sunk ship's halo keeps intercepting and can
never be shot. The new Sonar Net (Part 5) inherits exactly that behaviour on purpose, so
the two items stay consistent. If you ever fix it, fix both in the same change and update
both parts of this package.

### 5. The tutorial promises something the game does not do

Appendix C: beat 13 says "You can buy more mid-battle too." Nothing in this package adds
mid-battle buying, so the tutorial line should be corrected rather than the feature built.

### 6. Coins now have a sink

Doc §12.1 says coins accumulate and nothing spends them, and §15.2 describes the Port City
as a placeholder with "Coming soon" slots. Both sections need rewriting when Part 1 and
Part 2 ship; the roster in `00-OVERVIEW.md` §7 is the replacement for §15.2.

### 7. §7.3 gains exactly one exception

"One rule covers every weapon" stays true except for the Minesweeper, which never ends
your turn. That is deliberate, it is the item's whole identity, and it must be written
into §7.3 rather than left as a surprise.

### 8. Reward farming already exists, and this package makes it worth money

Hot-seat and offline matches already pay coins and rank points, and a player can farm both
against themselves or an Easy AI. Once steel buys buildings and raids take real loot, that
matters more. Part 1 adds a daily cap on **new** rewards (salvage, contracts, log ink) from
offline and hot-seat play and deliberately leaves coins and points alone, because changing
them is a design decision for you, not for an implementation ticket.

### 9. The lobby is the reason raids exist

The menu in the current build reads "1 sailors online" (also: singular/plural). A live-only
game cannot fill a queue at that size, which is why the 45-second bot fallback exists.
Asynchronous raids and pirate coves give a player a real opponent's layout to attack at any
hour without needing anyone else awake. That is the strategic argument for Part 6, and it
is worth putting in front of whoever decides the roadmap.
