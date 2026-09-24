# Part 8 — Fleets, donations, wars, visits and the Flag Hall: implementation plan

**Read:** `part-08-fleets.md`, `00-OVERVIEW.md`, `progress/REPO-MAP.md`,
`progress/part-06-report.md`, `progress/part-07-report.md`.

**Flag:** `portCity.fleets`, default off. Plus a second, nested flag: `fleets.freeText`,
default off, **which does not ship** (§2).

---

## 0. A naming collision to settle before anything else

`src/engine/fleet.ts` already exists and means **the eight ships**
(`FLEET_SPEC`, `FLEET_SHIP_COUNT = 8`, `FLEET_CELL_COUNT = 18`). Part 8's "fleet" is the
social unit — 30 captains, an Admiral, a war.

These are different things with the same word, and this repo has already been bitten once
by a fleet number that meant something other than what the reader assumed
(`arsenal-missing-in-battle`, where a stale `=== 10` silently wiped every offline board).

**Decision: the social unit is `src/engine/fleets/` — plural — and both files get a
header pointing at the other.** I considered renaming it (`squadron`, `armada`) to make
the collision impossible, and rejected it: the design doc, the SQL tables (`fleet_member`,
`fleet_request`) and the endpoints (`/fleet/*`) all say *fleet*, and a code-only synonym
would mean translating at every boundary forever. A one-character difference is a real
risk, but TypeScript fails loudly on a wrong import (the two modules share no export
names), and a test pins that `@engine/fleets` exports nothing to do with ships.

Recorded as a decision in the report.

---

## 1. The war scheduler — the only cron, and the part that must not be wrong

§6: *"it moves wars prep → battle → ended, settles rewards, and must be **idempotent and
restart-safe** (a crashed worker must not pay twice). Use a state machine with a
`settled_at` marker rather than a timer in memory."*

### The state machine

```
 searching ──(paired)──▶ prep ──(prep_ends_at)──▶ battle
     │                                               │
     │ (30 min, no match)                            │ (battle_ends_at)
     ▼                                               ▼
 cancelled                                       settling ──(paid)──▶ ended
```

Every transition is **one SQL statement with the current state in its `WHERE`**, so
running it twice moves nothing the second time:

| Tick step | Statement | Why it is idempotent |
| --- | --- | --- |
| 1 | `update war set state='battle' where state='prep' and prep_ends_at <= now()` | the second run matches 0 rows |
| 2 | `update war set state='settling' where state='battle' and battle_ends_at <= now()` | same |
| 3 | `select settle_war(id) from war where state='settling'` | see below |
| 4 | `update war set state='cancelled' where state='searching' and search_started_at < now() - 30 min` | same |

### Step 3 is the one that pays, so it is the one that matters

```sql
create function settle_war(p_war_id uuid) returns jsonb as $$
begin
  -- THE CLAIM. First statement in the transaction, and the only writer that
  -- can win it. `settled_at is null` is the marker §6 asks for.
  update public.war
     set settled_at = now(), state = 'ended'
   where id = p_war_id and state = 'settling' and settled_at is null;
  if not found then
    return jsonb_build_object('paid', false, 'reason', 'already-settled');
  end if;

  -- ...compute the winner, insert war_reward rows, move the wallets...
  -- ALL IN THIS SAME TRANSACTION.
end $$;
```

**Why this is exactly-once, in both failure modes the doc names:**

- **Run the job twice** (two workers, or a retry): the second `update` finds
  `settled_at is not null` and returns `already-settled` having written nothing. The row
  lock the first `update` takes serialises them, so "twice at the same instant" behaves
  the same as "twice in a row".
- **Kill it mid-settlement**: a plpgsql function is one transaction. If the worker dies
  after the claim but before the wallets move, the claim rolls back **with** the payment.
  The war returns to `settling` and the next tick legitimately retries. There is no state
  in which the claim is committed and the payment is not.

**A second, independent backstop:** `war_reward` has a unique key on `(war_id, user_id)`
and every insert is `on conflict do nothing`. If the claim were ever wrong, the rewards
still cannot double. Two mechanisms, because this one pays gems.

**Restart-safe** falls out of holding no timers: the scheduler is a `setInterval` that
re-reads the table every tick. A process that has been down for six hours catches up on
its first tick, because every transition is `<= now()` and not "did it fire while I was
watching". Nothing is scheduled in memory, so nothing is lost when memory goes.

The scheduler is `server/src/fleet/scheduler.ts`: `warTick(now)` is an exported async
function that does the four steps and returns what it moved, so **the tests call it
directly** rather than waiting on an interval.

---

## 2. The ranked-integrity rule

§3: *"Reinforcements are usable **only in raids and wars**, never in a ranked match — that
is the ranked integrity rule, and there is a test for it."*

The ranked path reads `placement.arsenal` (`app/(game)/searching.tsx:276`) and sends it
through `validateSubmission`. So the guarantee is made **structural, three deep**:

1. **Reinforcements are never items in a layout.** They live in their own server-side
   inventory (`donation` rows with `consumed_at is null`), not in `placement.arsenal`.
   There is no client action that loads one into the placement store.
2. **A pure function decides.** `usableReinforcements(context)` returns `[]` for
   `'ranked'` and the list for `'raid' | 'war' | 'friendly'`. One function, one test per
   context.
3. **The server refuses.** Only `/raid/open` and `/war/raid` accept a `reinforcements`
   parameter. The match server's `ready` frame has no such field — adding one would mean
   changing the frozen wire protocol, which is a conspicuous act.

The test asserts all three, including that the protocol mirror has no reinforcement field.

---

## 3. What gets built where

### Pure rules — `src/engine/fleets/`

| File | Owns |
| --- | --- |
| `types.ts` | `FleetRole`, `WarState`, `FleetPolicy`, the wire-ish shapes |
| `roles.ts` | §1's permission table, `can()`, kick/promote bounds, Admiral succession |
| `donations.ts` | commission price (`fuel × 6`), capacity by Fleet Hall level, the 30-min cooldown, `usableReinforcements()` |
| `war.ts` | best-stars-per-target scoring, both tiebreaks, the state machine's legal transitions, reward maths |
| `matchmaking.ts` | average renown of opted-in members, the widening schedule, the give-up |
| `chat.ts` | the ~24 quick phrases in four groups, the rate limit, the 7-day expiry |

### Server — `server/src/fleet/`

`repo.ts` (the seam), `service.ts`, `routes.ts`, `scheduler.ts`.

### Migration — `supabase/migrations/0017_fleets.sql`

§6's nine tables verbatim, plus `war_reward` (the backstop), plus `settle_war`,
`war_tick_*` and the fleet RPCs.

### Client — `src/fleet/`

`types.ts` (zod, strict, same as Part 7), `api.ts` (on `featureClient`), `store.ts`,
and pure `ui/` modules for everything a test needs to drive.

### Screens

```
app/fleet.tsx            the Fleet Hall: roster, chat, donations, war button
app/fleet-browse.tsx     find / create a fleet
app/fleet-war.tsx        prep day, battle day, the scoreboard
app/visit.tsx            a read-only city (§5)
app/flag-hall.tsx        the wall (§5)
app/country.tsx          the picker Appendix C says is missing
```

### Reuse, per Part 7's rule

- **The war harbour editor** is `app/(game)/placement.tsx` in `'harbour'` mode again,
  with a different save target. One new option on the existing setup bag.
- **A war raid** is Part 7's raid screen with `friendly`/`war` context: no loot chips, no
  renown line. Props on the existing steps, not a second screen.
- **The visit screen** is `app/city.tsx`'s plot renderer in a read-only mode.
- **Quick chat** reuses `src/net/chat.ts`'s ref-counted Realtime channel, one topic per
  fleet (`fleet:{id}`), with a new RLS policy alongside the existing two.
- **The Flag Hall** reuses `FlagChip` from `Hud.tsx`.

---

## 4. The country picker (Appendix C)

There is **no country list in the repo at all** today — `profile.countryCode` defaults to
`'IN'` and nothing ever sets it. So this ships `src/data/countries.ts` (ISO 3166-1 alpha-2
with names) and `app/country.tsx`: an ink list, alphabetical, a letter index down the
right side, and **no OS keyboard** — the same constraint `InkKeyboard` exists for.

The letter index is the whole design: 250 rows is too many to scroll, and the repo's rule
is no `TextInput`. Tapping a letter jumps the list; the index is a column of 26 ink
glyphs, dimmed for letters no country starts with.

---

## 5. Tests (§7, all eight)

| § | File | The interesting case |
| --- | --- | --- |
| 1 roles | `tests/fleets/roles.test.ts` | every cell of the table, both directions; Admiral leaves → highest active successor |
| 2 donations | `tests/fleets/donations.test.ts` | **a reinforcement cannot enter a ranked match** |
| 3 matchmaking | `tests/fleets/matchmaking.test.ts` | only opted-in count; widening; the 30-min give-up |
| 4 war scoring | `tests/fleets/warScoring.test.ts` | best-stars-per-target; destruction tiebreak; earlier-finish tiebreak; a member who never attacks |
| 5 scheduler | `server/tests/integration/war-scheduler.test.ts` | **run twice → paid once**; kill mid-settlement → still once |
| 6 friendly raids | `tests/fleets/friendly.test.ts` | no loot, no renown, no shield, no lock, absent from the defence log |
| 7 Flag Hall | `tests/fleets/flagHall.test.ts` | a flag is recorded once; the picker writes the profile |
| 8 quick chat | `tests/fleets/chat.test.ts` | rate limits; 7-day expiry; **no code path exists for free text** |

§7.5 is a real-Postgres test (PGlite, the real 0017) because "paid once" is a
transaction property and a fake cannot prove it. §7.2's ranked half is pure.

---

## 6. Risks

1. **The scheduler is the only thing here that can lose money.** Mitigated by the two
   independent mechanisms in §1 and by testing the crash path explicitly rather than
   only the happy one.
2. **`placement.tsx` gains a third mode.** Part 7 added `'harbour'`; the war harbour
   reuses it rather than adding `'war'`, with the save target passed in. No new branch in
   the screen.
3. **Scope.** This is the largest part in the package. If something has to give, it is
   the *screens*, not the rules, the server or the tests — a rule that is right and
   untested is a rule that will be wrong next month. I will say plainly in the report
   what is built and what is stubbed.
4. **`fleets.freeText` must not ship.** Not "is off": *absent*. The test asserts no
   module exports a free-text send path at all.
