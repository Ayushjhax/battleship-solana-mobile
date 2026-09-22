# Part 10 — Captains and new seas

**Depends on:** Part 5 · **Flags:** `portCity.captains`, `portCity.seas` · **Surface:** the engine again — treat it with the same care as Part 5

Two things that change how a match feels without changing what a match costs.

---

## Part 10A — Captains (Officers' Club, Admiralty 5)

### The rule that keeps it fair

A captain is **one ability, and the ability costs fuel out of the same 260**. Captains do
not level up into more power; they collect service stars, which are cosmetic. Both players
see each other's captain at the arena reveal, so there is always counterplay.

### The roster (v1)

| Captain | Fuel | Ability |
| --- | --- | --- |
| **Berhan, the Gunner** | 45 | Steady hand: the first plain shot of the match that misses does not end your turn |
| **Mara, the Engineer** | 25 | Reinforced mounts: each of your AA guns survives its first hit (marked as damaged, still guarding); the second destroys it |
| **Ivo, the Spy** | 15 | Intelligence: at the start of the match you are told how many mines, guns, nets and decoys the enemy placed — counts only, never cells |
| **Tomas, the Navigator** | 30 | Evasive: the first enemy torpedo that would strike one of your ships passes under it and carries on down the row |
| **Rosa, the Quartermaster** | 0 | Salvager: +25% salvage from this match. No effect inside the battle at all |
| **The Old Captain** | 20 | Seasoned: when your first ship is sunk, you are handed one free radar ping to use from the Arsenal tab |

Recruiting: coins or an achievement. Berhan is unlocked by beating him on Hard three
times — the most satisfying unlock in the game, and free.

### Engine integration

- `captainId` is part of each player's match config, resolved and validated server-side.
- Abilities are hooks in the existing resolution, not special cases sprinkled around:
  `onShotResolved`, `onTorpedoWouldStrike`, `onItemHit`, `onMatchStart`, `onShipSunk`.
  Each hook is pure and each ability is a small object implementing the hooks it needs.
- Every ability fires **at most once** and is recorded in the match log so the replay and
  the server agree.
- The AI: Hard brings Berhan. Easy and Normal bring none. The online bot brings none.
- Classic: no captains, ever.

### Tests

Each ability gets: the trigger fires once, never twice; it costs the right fuel; the layout
is rejected if the fuel does not fit; the opponent sees the captain at reveal and nothing
else; a match replay reproduces the ability exactly; Classic rejects a captain.
Rosa must be proven to have **zero** effect on any in-match state — a differential test
that plays the same seeded match with and without her and compares every event.

---

## Part 10B — New seas (Lighthouse, Admiralty 5)

### Terrain

Three cell types on top of the 10 × 10:

| Terrain | Rule |
| --- | --- |
| **Island** | No ship or item may occupy it. It is public from the start (drawn on both boards) and can never be fired on. A torpedo run **stops dead** at an island; a bomb or a blast that covers it simply does nothing there |
| **Reef** | Only ships of length ≤ 2 (destroyers and boats) may sit on it. Everything else behaves normally |
| **Fog** | A ship sunk inside fog does **not** auto-reveal the halo cells that are in fog. Cells outside the fog still hatch |

The halo rule still applies across terrain: an island does not let two ships touch.

### The seas

| Sea | Terrain | Notes |
| --- | --- | --- |
| Open Sea | none | the current board, and the only Classic board, forever |
| Archipelago | 7 islands scattered | torpedoes become much weaker, submarines much better |
| Coral Reef | a reef band across rows D–F | the battleship is squeezed into the top and bottom |
| Fogbank | fog over columns 6–10 | half the board keeps its secrets after a sink |
| The Strait | an island chain down column 5, reefs at the edges | two small seas joined in the middle |

Layouts are fixed per sea (not generated), tuned by hand so every sea still fits the whole
fleet with room to spare. A generator test proves each sea admits at least 100,000 legal
fleet placements, so nobody is ever stuck on Shuffle.

### Where a sea is used

- **Ranked:** the server picks the **season sea**, identical for both players, announced
  in the Gazette. Rotation is config, one sea per season, Open Sea at least every other
  season. The Lighthouse does not change what ranked plays — that is the integrity rule.
- **Unlocked by the Lighthouse:** offline, hot-seat, friendly and **your own harbour**.
  Putting your harbour on the Archipelago is a real defensive choice, and that is where
  city power is allowed to be power.

### Engine work

`terrain: TerrainCell[][]` in the match/raid config, defaulting to all-water. Placement
validation, shot legality, torpedo runs, bomb footprints, radar counts, the auto-reveal,
the AI's parity hunt and the layout generator all need to respect it. This is the largest
single change in the package after raids: do it behind the flag, with the generator test
and a full engine regression run before and after.

### Tests

Terrain legality (ships, items, reefs); islands stop torpedoes and swallow bombs;
fog suppresses only the fogged part of a halo; radar counts ships, not islands; Shuffle
always finds a legal layout on every sea (10,000 attempts, zero failures); the AI never
fires at an island and its hunt still converges (median shots per sea, recorded); ranked
uses the season sea for both players; Classic is Open Sea only; a replay of a terrain match
reproduces exactly.

## Acceptance criteria

1. Six captains, each one ability, each priced in fuel, each fully tested, each visible to
   the opponent.
2. Five seas that are legal, playable, AI-compatible and flag-gated, with ranked using one
   season sea for both players.
3. Classic untouched. The 260 budget untouched. Existing engine tests untouched.
