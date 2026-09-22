# Part 6 — Harbour raids: rules and server

**Depends on:** Parts 1 and 5 · **Flag:** `portCity.raids` · **Surface:** a new pure rules module, a new server service, the match server's neighbour
**Reference:** `reference/src/raid.ts` + `reference/test/raid.test.ts` (17 tests) and the calibration in `reference/out/raid.md`.

This is the centrepiece. It gives the game an opponent at three in the morning, it makes
the one skill the game already teaches — where you put your ships — matter permanently,
and it is the only place where city power is allowed to be power.

---

## 1. What a raid is

Your **harbour** is a saved 10 × 10 board: your ten ships plus defences bought with
**harbour fuel** from Coastal Command. Other captains attack that saved layout while you
are offline. You are never interrupted; you read about it afterwards in the defence log,
and you can watch the replay.

The attacker gets a **shell budget** instead of turns:

- Every shot costs **1 shell**.
- A **hit hands the shell straight back** — the asynchronous form of "hit, shoot again".
- Destroying a defence also hands the shell back.
- A **mine costs the shell plus 2 more**.
- Arsenal items from the **raid kit** cost no shells (they were paid for in raid fuel
  before the raid), but a mine caught in their footprint still charges the penalty.

So the budget is really "how many misses you are allowed", which is the same currency the
live game charges in turns.

## 2. The numbers

See `NUMBERS.md`. The headline ones: **30 shells**, mine penalty **2**, raid clock
**4 minutes**, stars for the battleship / 50% / 100%, destruction = enemy ship cells hit ÷ 20.

### Where 30 comes from

From `reference/out/raid.md`, 1,500 simulated raids per row, raider = the masked-view
hunt/target AI (doc §10) at Normal:

- Clearing an undefended harbour takes a median of **58 shots**, of which 20 are hits, so
  about **37 misses**. Four single-cell boats are what make it expensive — parity does not
  help against a 1-cell ship.
- At 30 shells with a mid kit: **3★ 21%**, 2★ 72%, 1★ 4%, 0★ 3% against a typical
  5-mine / 2-gun harbour, and 3★ 15% against a maxed one.
- At 40 shells the same raider 3★s 62% of the time, which would make defences pointless.
  At 24 shells, 11% of raids end with nothing at all, which feels bad.

So 30 gives: almost every raid earns something, two stars is the normal result, three
stars is an achievement, and a maxed harbour roughly halves the attacker's 3★ rate.
Keep it server-configurable (`raid.shells`) and watch the live distribution.

### What each defence is worth (same run, section D)

| Harbour | 3★ rate against it |
| --- | --- |
| bare fleet | 45% |
| + 3 mines (15 fuel) | 32% |
| + 5 mines (25 fuel) | 27% |
| + 8 mines (40 fuel) | 19% |
| + 1 AA gun (10 fuel) | 40% |
| + 3 AA guns (30 fuel) | 33% |
| 5 mines + 2 guns + 2 decoys (55 fuel) | 17% |

Mines are the best fuel-for-fuel defence, which is why Coastal Command caps them.

## 3. The harbour

- Unlocks at **Admiralty 3**, when Coastal Command is built. Below that a player cannot
  raid and **cannot be raided**.
- The harbour layout is the standard fleet (all ten ships, no-touch rule) plus defences.
- **Harbour fuel** by Coastal Command level: 50 / 70 / 90 / 110 / 130 / 150.
- Item caps by Coastal Command level:

| Level | Mines | AA guns | Sonar nets | Decoys |
| --- | --- | --- | --- | --- |
| 1 | 3 | 1 | 1 | 1 |
| 2 | 4 | 2 | 1 | 1 |
| 3 | 5 | 2 | 2 | 2 |
| 4 | 6 | 3 | 2 | 2 |
| 5 | 7 | 3 | 2 | 3 |
| 6 | 8 | 4 | 3 | 3 |

Nets and decoys also require the Academy research (Part 5). Prices are the same as in a
match. Radar is not a harbour defence (there is nobody there to read it).

- When raids unlock, the server generates a **legal default harbour** (random fleet,
  defences filling the budget) so nobody is ever raidable with an empty board.
- Editing is allowed any time except while a raid on you is in progress; a raid always
  runs against the **snapshot taken when it started**.

## 4. The raid kit

- **Raid fuel** by Armory level: 40 / 60 / 80 / 100 / 120.
- Buyable: every offensive item the player has (torpedo, double torpedo, bomber, atomic,
  submarine, radar, minesweeper if researched) at match prices and match caps.
- The kit is chosen **before** searching for a target and is spent during the raid. Items
  left over are returned to nothing — the fuel is per raid, like the 260 is per match.
- AA guns intercept aircraft and sonar nets eat submarines during raids exactly as in a
  match, and the interception reveals the defence to the attacker for the rest of that raid.

## 5. Finding a target

`POST /raid/search` costs **10 × Admiralty level** coins and returns one target.

Eligibility, in order:
1. Not yourself, not shielded, not raid-locked, Admiralty ≥ 3, has a valid harbour.
2. Renown within ±200, widened by 100 every second search in the same session, uncapped
   after 8 searches.
3. Not raided by you in the last 24 h (revenge is exempt).
4. If nothing fits after the widening, return a **Pirate cove**.

**Pirate coves** are server-generated PvE harbours: a seeded legal fleet plus defences
sized to the searcher's renown. They are labelled as pirate coves in the UI — never
disguised as a person. Their loot is paid by the house (70% of a normal pool) and they
give **no renown**. They are what makes the feature work on a day when nobody is online,
which today is most days: the menu still says "1 sailor online".

A search result is a **target card**: name, avatar, flag, Admiralty level, renown,
available loot, and the renown offer (+X for 3★ / −Y for 0★). Taking the card puts a
**raid lock** on the defender for 6 minutes.

## 6. Running the raid

The server owns the board. The client sends actions; the server resolves them with the
shared engine and returns only what the rules have made public. The hidden layout is
never sent — same rule as §11.4, and there must be a test that fails the build if it ever
appears in a raid payload.

| Action | Server does |
| --- | --- |
| `fire {cell}` | validates the cell is unmarked, resolves it, applies the shell maths, returns the resolution + shells left |
| `use {weapon, target}` | validates the item is in the kit and unspent, resolves it (with interception), returns the attack |
| `retreat` | ends the raid with whatever has been earned |

The raid ends when: the fleet is cleared, shells are 0 **and** the kit is empty, the
4-minute clock runs out, the attacker retreats, or the attacker disconnects for more than
60 s (the raid settles with what it had — never "no result").

## 7. Settlement

1. `stars` and `destruction` are computed from the final board.
2. **Loot**: a pool is computed from the defender at raid start (10% of the wallet above
   the vault, 50% of everything sitting in collectors and the scrap pile, capped by the
   defender's Admiralty level — `NUMBERS.md`). The attacker earns `pool × destruction`,
   plus a **star bonus paid by the house** (0 / 40 / 120 / 300 steel). The defender loses
   only the pool part, taken from collectors and the scrap pile first, then the wallet.
3. **Renown** moves (`NUMBERS.md`): stars > 0 → the attacker gains `offer × stars / 3` and
   the defender loses the same; 0 stars → the attacker loses a smaller amount and the
   defender gains it. Renown floors at 0, is a separate ladder, and **never touches rank
   points**, which still only go up.
4. **Shield** for the defender by destruction taken: ≥ 40% → 6 h, ≥ 70% → 10 h, 100% → 14 h.
   Raiding while shielded drops your own shield (with a confirmation).
5. Everything above happens in **one transaction** with ledger rows for both sides, and a
   `raid` row plus a `raid_log` for the replay.
6. The defender gets a defence-log entry and, if a raid with ≥ 2★ happened while they were
   away, an attention badge on the menu.

## 8. Replays

Store `{ layoutSnapshot, kit, actions[], config, engineVersion, seed }`. The replay is
produced by **re-running the engine** over the actions, not by storing rendered frames.
If `engineVersion` no longer matches, fall back to the stored per-action results (keep
them: they are small) and mark the replay "as recorded".

Both sides may watch. The defender sees their own full board (they own it). The attacker
sees the board as it ended plus whatever they revealed — and, once the raid is over, the
full layout, exactly as Clash of Clans does. The Captain warns the defender: "They have
seen your harbour now. Move something."

## 9. Data model

```
harbour:     user_id, layout(json), fuel_used, updated_at, valid(bool)
raid:        id, attacker_id, defender_id|null, cove_seed|null, started_at, ended_at,
             stars, destruction, shells_left, loot_coins, loot_steel, renown_attacker,
             renown_defender, end_reason
raid_log:    raid_id, actions(json), results(json), engine_version
raid_lock:   defender_id, raid_id, expires_at
shield:      user_id, until
renown:      user_id, value, best, updated_at
```

Indexes for the search: `(renown)` where not shielded and not locked and admiralty ≥ 3.

## 10. Anti-cheat and abuse

- Everything hidden stays server-side; the client gets marks, shells, stars and loot.
- Five rejected raid actions from one session ends the raid (mirrors the match rule).
- Rate limit: 4 actions/second, and a raid cannot last beyond its clock + 10 s grace.
- Search cost and the raid lock stop target-shopping; the lock expires by itself.
- **Farming your own alt:** the same device or the same IP raiding the same defender
  repeatedly is flagged in telemetry, and the 24-hour repeat rule blocks the obvious case.
- A defender's harbour is validated on save: legal fleet, within budget and caps, items
  researched. An invalid harbour is refused, and the last valid one keeps defending.

## 11. Tests

Port `reference/test/raid.test.ts`, plus:

**Shells** — miss −1; hit 0; item destroyed 0; mine −3; decoy 0 then the shells spent
around it; firing at a resolved cell is refused and costs nothing; a kit item costs no
shell; an intercepted plane is still spent.

**Stars** — battleship only = 1★ at 20% destruction; 50% without the battleship = 1★;
battleship + 50% = 2★; everything = 3★ and the raid ends as `cleared`.

**Ends** — out of shells with an empty kit; shells at 0 but a bomber left keeps it alive;
the clock; retreat; disconnect settles rather than voiding.

**Loot** — the vault floor and the per-raid cap; 50% of collectors and the scrap pile;
loot is proportional to destruction; the star bonus is paid by the house so the defender
never loses more than the pool; a defender with nothing loses nothing and the attacker
still gets the star bonus.

**Renown** — symmetric, floors at 0, bigger for punching up, negative for 0★, and a pirate
cove moves nothing.

**Search** — never returns you, a shielded player, a locked player, an Admiralty-2 player,
or someone you raided in the last 24 h; widens correctly; falls back to a cove; charges
the coins once even if the caller retries with the same `requestId`.

**Concurrency** — two attackers cannot lock the same defender; a defender editing their
harbour mid-raid does not change the raid; a raid settling twice credits once.

**Secrecy** — a fuzz test over 500 random raids asserts that no payload ever contains an
un-hit ship cell, an unexposed decoy's kind, or an undiscovered item.

**Replay** — replaying the stored actions reproduces the same stars, destruction and marks,
bit for bit, and a version mismatch falls back without throwing.

**Manual QA:** raid a pirate cove; raid a real account from a second device; check the
defence log, the shield, the renown change and the replay on both sides; disconnect
mid-raid and confirm it settles.

## 12. Acceptance criteria

1. A player at Admiralty 3+ can set a harbour, find a target, raid it, and see the result
   settle on both accounts exactly once.
2. The raid rules match this document and the reference implementation.
3. No hidden information ever leaves the server.
4. With no other humans online, every search still returns a raid worth doing.
5. Rank points, coins from matches, and the live match game are all untouched.

## 13. Out of scope

The client (Part 7), fleet wars (Part 8), leagues and seasons for renown, revenge chains
beyond the single revenge, push notifications.
