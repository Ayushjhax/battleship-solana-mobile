# Part 9 — The Port Gazette, the daily puzzle and trade voyages

**Depends on:** Parts 2 and 4 · **Flags:** `portCity.gazette`, `portCity.voyages` · **Surface:** Newsstand, Trade Docks, one daily generator, one small skirmish mode

Three reasons to open the app on a day when you do not feel like playing a match.

---

## 1. The Port Gazette (Newsstand, Admiralty 2)

A hand-drawn newspaper, one edition per player per day, generated server-side on first
open and then cached for the day.

**Layout:** masthead (THE PORT GAZETTE), date, a joke price ("one coin"), one big
headline, two or three sub-stories, "Captain's corner" (a rotating tactical tip), a
weather box (nautical flavour, decorative), and the back page — the daily puzzle.

**Where the stories come from:** the player's own last 24 hours (matches, raids,
defences, city milestones, contracts) plus a small global feed (top three of the
leaderboard, the biggest raid of the day, fleet war results, event news).

**Headline generation is templates, not prose generation.** About 40 templates, each with
a trigger and a score; the highest-scoring event of the day becomes the headline, the next
two become sub-stories. Examples:

| Trigger | Template | Score |
| --- | --- | --- |
| ≥ 3 planes downed by one gun in a match | "{name} downs {n} bombers with a single gun!" | 70 |
| Atomic sank ≥ 2 ships | "Atomic strike! {k} ships lost in one blast off {rowLetter}" | 80 |
| Defended a raid under 2★ | "Harbour holds: {raider}'s raid stopped at {pct}%" | 75 |
| Rank up | "{name} made {rank}" | 90 |
| 3★ raid | "{name} clears {defender}'s harbour" | 85 |
| Nothing happened | "Quiet week on the water" (with a tip) | 0 |

Names are already 1–14 characters and profanity-filtered at creation, so no new moderation
surface. Templates are localisable strings with named slots, never concatenated sentences.

**Share:** "Cut out this page" exports the edition as an image if the repo already has a
view-shot dependency; otherwise the button is hidden. Never add a dependency for this.

## 2. The daily puzzle

- One board per UTC day, identical for **every** player, seeded by the date. Standard
  fleet, standard rules (no-touch, auto-reveal), **no turn limit and no arsenal**.
- Goal: sink all ten ships in as few shots as possible.
- **Par is 52.** From `reference/out/puzzle.md` (2,000 boards): a competent solver's median
  is 57 shots and its best quartile is 52, so par rewards genuinely good search. Under 46
  is an "Admiral's round" (the best 10%).
- Server-authoritative: the layout never reaches the client. Each shot is an API call that
  returns one resolution. That also makes the leaderboard trustworthy.
- Rewards: completing pays 200 coins, 200 steel and 50 ink; beating par adds 10 gems;
  streaks of 3 / 7 / 30 days pay bonuses. One attempt per day, resumable if the app dies.
- **Share result** as an emoji grid — this is the cheapest marketing the game will ever get:

```
Port Gazette puzzle #142 — 49 shots (par 52)
🟦🟦🟥🟥⬜🟦⬜⬜🟦⬜
…
```

🟥 hit, 🟦 miss, ⬜ never fired. Copy to clipboard; no share sheet dependency needed.

- A per-day leaderboard (global top 100 and your fleet), ranked by shots, then by time
  taken.

## 3. Trade voyages (Trade Docks, Admiralty 4)

- Merchant ships = Trade Docks level (1 / 2 / 3 slots).
- Routes, each with a duration, a reward table and a pirate risk:

| Route | Time | Reward (typical) | Pirate risk |
| --- | --- | --- | --- |
| Coral Bay | 1 h | 120 coins **or** 150 steel | 5% |
| Saltmarsh | 4 h | 400 coins or 500 steel | 10% |
| Iron Point | 8 h | 900 coins or 1,100 steel, small gem chance | 15% |
| Far Isles | 12 h | 1,500 coins or 1,900 steel, gem chance, cosmetic chance | 20% |

Rewards scale with Trade Docks level and are rolled **server-side at send time** (so the
player cannot reroll by reinstalling), revealed on return.

- **Pirates.** On a risk hit the voyage returns as "Under attack!" and the player plays a
  **5 × 5 skirmish**: a small board, a fleet of one 3-cell, one 2-cell and two 1-cell
  ships, no-touch rule, no arsenal, 10-second turns, the player shoots first, against the
  Normal AI. Win → full cargo plus a 25% bonus. Lose or ignore it for 24 h → half cargo.
- The skirmish runs on the client for speed, and the client submits the event log; the
  **server replays it** with the same seeded AI and layout and refuses anything that does
  not reproduce. Deterministic AI plus seeded layout makes this cheap and safe.
- The dock shows ships out with their timers, and returning ships sail in and drop a chest.

## 4. Data model and API

```
gazette:    user_id, date, edition(json), read_at
puzzle:     date, layout(json, server only), par
puzzle_run: user_id, date, marks(json), shots, finished_at, streak
voyage:     id, user_id, route, sent_at, returns_at, reward(json), pirate(bool), state
skirmish:   voyage_id, seed, layout(json), log(json), result
```

`GET /gazette` · `GET /puzzle` · `POST /puzzle/fire {cell}` · `GET /puzzle/leaderboard` ·
`POST /voyage/send {route, slot}` · `POST /voyage/collect {id}` ·
`POST /voyage/skirmish {id, log}`.

## 5. Tests

1. The same date gives every player the same puzzle layout; a different date gives a
   different one; the layout never appears in any response.
2. Puzzle resume: kill the session mid-solve, resume, shots and marks intact; a second
   attempt on the same day is refused.
3. Par and reward thresholds, including the streak boundaries and a missed day resetting
   the streak.
4. The emoji grid is exactly 10 × 10 and matches the marks.
5. Gazette: a player with no activity gets the quiet-day edition, never an empty page;
   headline scoring picks the right story from a crafted day; every template renders with
   every slot filled; the edition is stable for the whole day.
6. Voyages: rewards are rolled at send time and cannot change; a voyage cannot be
   collected early; slots are enforced; a pirate skirmish log that does not replay is
   rejected and pays half.
7. Skirmish rules on the 5 × 5 board: no-touch placement is still satisfiable (there is a
   test that generates 10,000 legal boards), turns, win/lose.

**Manual QA:** solve the puzzle and share the grid; send three voyages and let one be
attacked; read a Gazette after a big raid and check the headline is the right one.

## 6. Acceptance criteria

1. One puzzle a day for everyone, solved server-side, with a shareable result.
2. A Gazette that is different every day and never empty.
3. Voyages that pay on time, cannot be farmed by reinstalling, and whose skirmishes are
   verified by replay.
