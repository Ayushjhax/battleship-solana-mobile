# Part 6 — Harbour raids (rules + server): implementation plan

**Read:** `part-06-raids-engine.md`, `00-OVERVIEW.md`, `NUMBERS.md`, `progress/REPO-MAP.md`,
`progress/part-01-report.md`, `progress/part-05-report.md`,
`reference/src/raid.ts`, `reference/test/raid.test.ts`, `reference/out/raid.md`.

Reference suite re-run before starting: **80/80**.

---

## 0. The finding that changes a number before I write a line

`part-06` §1 says the harbour is "your **ten** ships". §2 says
**"destruction = enemy ship cells hit ÷ 20"**. `reference/src/grid.ts:18` agrees:
`FLEET_CELLS = 20`, from a fleet with **four** single-cell boats.

**This game does not have that fleet.** `src/engine/fleet.ts`:

```ts
export const FLEET_SPEC = [
  { class: 'battleship', len: 4, count: 1 },
  { class: 'cruiser',    len: 3, count: 2 },
  { class: 'destroyer',  len: 2, count: 3 },
  { class: 'boat',       len: 1, count: 2 },   // TWO, not four
];
export const FLEET_SHIP_COUNT = 8;   // not 10
export const FLEET_CELL_COUNT = 18;  // not 20
```

The header of that file says why: *"the classic ten-ship fleet minus two of the four
one-cell boats, which made placement fiddly and added little to the game."*

Three consequences, and none of them is cosmetic:

1. **Destruction must be `cellsHit / FLEET_CELL_COUNT` (÷18), not ÷20.** Hard-coding 20
   would make 100% destruction unreachable — 18/20 = 90% — so **no raid could ever earn the
   third star**. This is the same class of bug the repo has already been bitten by once
   (memory: a stale hardcoded fleet count of 10 silently wiped every offline board). I will
   take the constant from the engine and add a test that fails if it is ever inlined.
2. **`reference/out/raid.md` is calibrated against a different game.** §2 is explicit that
   *"four single-cell boats are what make it expensive — parity does not help against a
   1-cell ship"*. With two boats instead of four, a shipped harbour is **cheaper to clear**,
   so 30 shells should produce a **higher** 3★ rate here than the reference predicts.
3. **I will measure it rather than assume it**, with the same method the reference used
   (Normal masked-view AI, 1,500 raids per row), and put my table beside theirs in the
   report. The user asked for exactly this comparison; §0's arithmetic is my prediction, and
   the measurement is the answer.

**The 30-shell budget is not changed** (instructed, and correctly — it is the design's
chosen difficulty). It becomes server-configurable as `raid.shells`, per §2.

---

## 1. The raid state machine

```
        POST /raid/search  (costs 10 x Admiralty coins, takes a raid_lock)
                 |
                 v
   [searching] --+--> target card (human)  --\
                 \--> pirate cove (seeded)  --+--> POST /raid/start
                                              |
                                              v
                                       +-------------+
                     fire / use ------->|   RUNNING   |<------ 4-minute clock
                                        +-------------+
                                              |
        cleared | out_of_shells | time | retreat | disconnect(>60s)
                                              |
                                              v
                                        +-----------+
                                        | SETTLING  |  ONE transaction
                                        +-----------+
                                              |
                                              v
                                          [SETTLED]
```

**Where it lives.** A raid is *not* a `Room`. The match room
(`server/src/room.ts`) is two live sockets, a turn timer and a reducer that alternates
seats; a raid is one attacker against a **frozen snapshot**, with shells instead of turns
and no second party present. Forcing them together would put `if (isRaid)` through the most
safety-critical file in the app.

Instead: `server/src/raid/session.ts` holds live raids in a `Map` beside `rooms`, with the
same lifecycle shape (in-memory, single instance, settle-on-finish) so the operational rules
already written down for rooms apply unchanged. What they **share** is the engine — every
cell resolution, every interception, every mark goes through `resolveCell` / `useWeapon`
from `src/engine`, which is what makes a raid obey exactly the rules a match does.

**Disconnect settles, never voids** (§6). The session keeps a 60 s timer exactly as a room
keeps its 45 s forfeit timer; on expiry it settles with whatever was earned.

---

## 2. Rules — `src/engine/raid/` (pure)

| Export | Contract |
| --- | --- |
| `startRaid(layout, kit, config, startedAt)` | builds the working board from the snapshot |
| `fireShell(state, cell, now)` | one shell; returns `{ resolution, shellDelta }` or a typed error |
| `useKit(state, kind, target, now)` | costs **no shell**; a mine in the footprint still charges the penalty |
| `retreat(state, now)` | ends as `retreat` |
| `settleRaid(state, now)` | final stars / destruction / end reason |
| `raidScore(state)` | `{ cellsHit, destruction, battleshipSunk, stars, shipsSunk }` |

Shell maths, exactly as §11 lists it:

| Outcome | Δ shells |
| --- | --- |
| miss | −1 |
| hit / sunk | 0 |
| decoy hit | 0 (it is indistinguishable — Part 5) |
| item destroyed | 0 |
| mine | −1 − `minePenalty` (= −3) |
| kit item | 0, but a mine in its footprint charges `minePenalty` |
| illegal cell | refused, costs nothing |

Stars: `battleshipSunk ? 1 : 0` + `destruction >= 0.5 ? 1 : 0` + `destruction >= 1 ? 1 : 0`.
Destruction: `cellsHit / FLEET_CELL_COUNT`, imported, never inlined (§0).

The module is pure and imports only `src/engine` — so it runs in the app (for Part 7's
replays) and the server identically, and it is testable under plain Node.

---

## 3. Harbour and kit

**Storage.** `harbour(user_id pk, layout jsonb, fuel_used int, valid bool, updated_at)`.

**Validation on save**, refusing rather than silently dropping (§10):
legal fleet via the engine's `validateFleetComposition` + `validateLayout`; every item
placed legally (the decoy's no-touch rule from Part 5 applies); within the Coastal Command
**fuel** (50/70/90/110/130/150) and the **per-level caps** in §3's table; nets and decoys
require the Academy research. Radar is refused outright — "there is nobody there to read
it".

**A default harbour is generated on unlock** so nobody is ever raidable with an empty board:
`autoPlaceFleet(createRng(seed))` plus defences filling the budget, seeded from the user id
so it is reproducible.

**The snapshot rule.** `raid.layout_snapshot` is written at `startRaid`. A defender editing
their harbour mid-raid changes nothing about the raid in flight — there is a test.

**The kit** is bought from Armory raid fuel (40/60/80/100/120) at match prices and match
caps, chosen *before* searching, and spent during the raid; leftovers expire.

---

## 4. Matchmaking and settlement

### The search query and its indexes

```sql
select p.id, p.name, r.value as renown, ...
  from profiles p
  join renown r        on r.user_id = p.id
  join harbour h       on h.user_id = p.id and h.valid
  join city c          on c.user_id = p.id
 where p.id <> :me
   and p.is_bot = false
   and (c.state->'buildings'->'admiralty'->>'level')::int >= 3
   and not exists (select 1 from shield    s where s.user_id = p.id and s.until > now())
   and not exists (select 1 from raid_lock l where l.defender_id = p.id and l.expires_at > now())
   and not exists (select 1 from raid      x where x.attacker_id = :me and x.defender_id = p.id
                                             and x.started_at > now() - interval '24 hours')
   and r.value between :lo and :hi
 order by random() limit 1;
```

Indexes: `renown(value)`, `shield(user_id, until)`, `raid_lock(defender_id, expires_at)`,
`raid(attacker_id, defender_id, started_at desc)`, `harbour(user_id) where valid`.

The Admiralty-3 gate reads the Part 1 city JSON, so it also needs
`city ((state->'buildings'->'admiralty'->>'level'))` as an expression index.

Window: ±200 renown, **+100 every second search in the same session, uncapped after 8**.
No match after widening → **pirate cove**, labelled honestly, house-paid loot at 70%, and
**no renown movement at all**.

### Settlement — one transaction

`settle_raid(...)` in SQL does all of it or none of it:

1. loot pool from the **defender at raid start**: 10% of wallet above the vault + 50% of
   collectors and the scrap pile, capped by the defender's Admiralty level (`NUMBERS.md`);
2. attacker earns `pool × destruction` **plus a house-paid star bonus** (0/40/120/300 steel)
   — so the defender never loses more than the pool;
3. defender loses the pool part only, **collectors and scrap pile first**, then the wallet;
4. renown: symmetric, floors at 0, never touches `rank_points`;
5. shield by destruction taken: ≥40% → 6 h, ≥70% → 10 h, 100% → 14 h;
6. `economy_ledger` rows for **both** sides, a `raid` row, a `raid_log` for the replay, and
   a defence-log entry.

Idempotent on `raid.ended_at is null`, exactly like `apply_match_result` — a second call
returns "already settled" and moves nothing.

---

## 5. How I guarantee no hidden cell is ever serialised

This is the hard rule, and I am treating it the way Part 5 treated the decoy.

1. **One projection function.** `raidView(state)` is the *only* thing that may leave the
   session, and it returns marks, shells, stars, kit counts and revealed items — never
   `layout`, never `ships`, never an unexposed decoy's kind. Everything else in the module
   returns internal types the route layer cannot reach.
2. **A 500-raid fuzz test** (§11): random legal harbours, random raider actions, and after
   *every* action the serialised payload is asserted to contain no un-hit ship cell, no
   unexposed decoy kind and no undiscovered item. It fails the build on a single leak.
3. **Structural, not just behavioural:** the payload type has no field that could hold a
   layout, so a leak requires someone to add one — and the fuzz test then catches it.

This mirrors the two guards that already exist: `src/engine/__tests__/view.test.ts` for
matches and the decoy secrecy test from Part 5.

---

## 6. Tests

Every §11 group: shells (8 cases), stars (4), ends (5 incl. disconnect), loot (5), renown
(4), search (7), concurrency (3), secrecy (the 500-raid fuzz), replay (2).
Ported from `reference/test/raid.test.ts` where they exist there.

Plus the **star-distribution measurement** the report needs: 1,500 raids per row against
bare / CC1 / CC3 / CC6 harbours at 30 shells with a Normal raider, tabulated beside
`reference/out/raid.md`.

---

## 7. Risks

1. **The ÷18 vs ÷20 trap** (§0) — the single most dangerous number in the part.
2. **Settlement must not double-credit.** Same shape as `apply_match_result`, same
   idempotency guard, and a pglite test that settles twice.
3. **Raid locks and concurrency** — two attackers must not lock one defender. Enforced by a
   unique index on `raid_lock(defender_id)` plus an upsert that fails on conflict, not by a
   read-then-write.
4. **Renown must never touch rank points.** Separate table, separate ladder; a test asserts
   `rank_points` is unchanged by every raid path.
5. **The Admiralty-3 gate cuts both ways** — a player below it can neither raid nor be
   raided, so the search must exclude them as targets *and* refuse them as searchers.
