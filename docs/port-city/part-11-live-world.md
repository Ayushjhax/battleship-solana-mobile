# Part 11 — The living city, the World Boss and the Empire map

**Depends on:** Parts 2 and 6 · **Flags:** `portCity.worldBoss`, `portCity.empire` · **Surface:** city polish, one live event service, one PvE campaign

The parts that make people show the game to someone else.

---

## 11A — The living city

- **Night.** From 19:00 to 06:00 local (or forced in Settings: Auto / Day / Night) the
  paper flips: deep blueprint blue, strokes in white and pale blue, warm dots in the
  windows, and the Lighthouse beam sweeping the harbour every 6 s. The scene image is
  recoloured with a colour matrix rather than a second asset; the vector buildings take a
  palette swap. Contrast must pass the same legibility test as Part 3's papers.
- **Seasons.** Server-configured date windows add an overlay to the scene: snow hatching,
  lantern strings, festival lights, a harvest banner. Each is a small sprite set plus a
  palette tweak — never a second scene. Ship with at least two so the system is proven.
- **Weather**, rare and cheap: a five-minute rain pass (diagonal ink dashes, gulls gone)
  once or twice a day, skipped under reduced motion.
- Everything here is decoration and must be provably free of gameplay effect.

## 11B — The World Boss: "The Great Armada"

Once a month, for 72 hours, one enormous enemy fleet appears that **every captain in the
game shoots at together**.

- The board is drawn as **graph-paper sheets taped together** — 3 × 3 sheets, 30 × 30
  cells — and it holds a seeded armada: about 40 ships including a 6-cell **Flagship**,
  plus mines.
- Every player gets **5 shots a day**, plus one from the Gazette puzzle and one per fleet
  war raid, capped at 10 a day.
- **All hits are shared.** The board is global: you see the marks everyone else has made,
  refreshed on open and every 10 s while the screen is open (reuse the realtime channel;
  fall back to polling).
- Concurrency is the whole problem: the first shot on a cell wins, and a shot that lands
  on an already-resolved cell is **refunded**, not wasted. Resolve shots in a single
  serialised writer per event (a queue, or a row lock on the cell).
- Sinking a ship credits the captain who landed the last cell and everyone who hit it.
- **Waves.** When the armada is cleared, the next wave spawns immediately, bigger and with
  more mines. That is what makes the event work whether 50 or 50,000 people play.
- Rewards: participation (≥ 1 shot), personal contribution tiers, and **global milestones**
  at 25 / 50 / 75 / 100% of each wave, paid to everyone who fired in that wave. The
  Flagship sinking triggers a global ink celebration and a gem payout.
- The event never touches rank or renown, and never costs anything to enter.

**Tests:** two shots at the same cell in the same millisecond resolve once and refund
once; a wave rollover mid-shot is consistent; milestone rewards pay once per player per
wave; a player who fires their 5 shots cannot fire a 6th; the whole board never ships the
un-hit ship cells to the client.

## 11C — The Empire map

Pinch out far enough in the city and it shrinks to a dot on a hand-drawn chart.

- About **20 ports in 4 regions**, each a handcrafted PvE battle against the AI with a
  fixed layout, a fixed kit, and a twist (no arsenal; only torpedoes; a 6-mine harbour;
  a fog sea). Stars: win (1), win with ≥ N ships afloat (2), win within N turns (3).
- **Region bosses**, each needing a small engine extension, all PvE-only and flagged:
  - **The Kraken** — occupies an irregular polyomino instead of a straight ship (the
    engine's ship model needs to allow arbitrary connected shapes for PvE).
  - **The Ghost Fleet** — every third of its turns, one un-hit ghost ship moves to another
    legal position, and your marks on it fade. Needs a relocate hook and a "fading mark"
    render.
  - **The Pirate King** — five AA guns, eight mines, two decoys, and a taunting Captain.
- A conquered port flies your flag and pays **tribute**: a small daily trickle of coins and
  steel collected at the Customs House plot in the city. Total tribute at 100% is capped at
  roughly one Foundry level, so the campaign is a nice-to-have, not the main economy.
- Progress is shown as "Empire 34%", and the game's name finally means something.

**Tests:** every port is winnable (a scripted solver beats each one); star conditions;
tribute accrues and caps; polyomino ships obey the halo rule and sink correctly; ghost
relocation only ever picks legal positions and never moves a hit ship; the campaign cannot
touch ranked, renown or the arsenal catalogue.

## Acceptance criteria

1. Night, seasons and weather look right and change no rule.
2. A world boss that behaves correctly under concurrency, scales by waves, and pays out
   exactly once per player per wave.
3. A campaign of 20 ports and 3 bosses, all winnable, all PvE-flagged, paying capped
   tribute.
