# Part 8 — Fleets, donations, wars, visits and the Flag Hall: report

**Flag:** `portCity.fleets`, default off. Plus `fleets.freeText`, default off, **with
nothing behind it** — see §4.

**Status:** automated tests green — `npm test` **999/999** (app, +171) · `npm test` in
`server/` **287/287** (+15) · `tsc --noEmit` clean in both · `npx eslint .` clean.

**Read §8 first if you are deciding what to do next.** The rules, the SQL, the scheduler
and all eight §7 test groups are complete. Three of the six screens are not, and I say
exactly which.

---

## 1. The war scheduler

The instruction singled this out, so it gets the first section.

§6: *"it moves wars prep → battle → ended, settles rewards, and must be idempotent and
restart-safe (a crashed worker must not pay twice). Use a state machine with a
`settled_at` marker rather than a timer in memory."*

### Idempotent

Every transition is **one SQL statement with the current state in its `WHERE`**, so a
second run matches zero rows:

```sql
update war set state='battle' where state='prep' and prep_ends_at <= now()
```

Settlement is the one that pays, so it has **two independent guards**:

| | Mechanism | What it survives |
| --- | --- | --- |
| 1 | **The claim.** `set settled_at = now() where state='settling' and settled_at is null`, the first statement in `settle_war` | two workers arriving together (they serialise on the row lock), and any number of retries |
| 2 | **The backstop.** `war_reward` is unique on `(war_id, user_id)`; every insert is `on conflict do nothing`, and the wallet moves only for rows actually inserted | the claim itself being wrong |

The second one is not belt-and-braces theatre. There is a test that **forces the war back
to `settling` and clears `settled_at`** — i.e. pretends the claim failed completely — and
asserts the money still does not move.

### Restart-safe

Because it holds **no timers**. There is no `setTimeout(settle, prepEndsAt)`; there is a
`setInterval` that re-reads the table, and every condition is `<= now()` rather than "did
it fire while I was watching". A process down for six hours catches up on its first tick —
there is a test that runs prep → battle → settling → ended in a single pass.

### Killed mid-settlement

A plpgsql function is **one transaction**. A worker that dies after the claim but before
the wallets move rolls back *both*. There is no state in which the war is marked settled
and the payment is not.

The test does the equivalent and stronger thing: it runs the settlement inside a
transaction, asserts the payment *was* applied inside it, **rolls back**, and then checks
that the war is still `settling`, `settled_at` is still null, the wallet is untouched and
there are no reward rows — and then lets the next tick pay, once.

`warTick()` is exported and does one full pass, so **the tests call it directly** rather
than waiting on an interval. A scheduler you can only test by sleeping is a scheduler
nobody tests.

---

## 2. The ranked-integrity rule

§8.2: *"Nothing a fleet gives a player can enter a ranked match."*

A fleet is a machine for handing people free weapons, and the ranked ladder is the one
thing in the game with no other protection — no shield, no lock, no cap that would notice
an extra bomber. So it is enforced **three deep**, and tested at all three:

1. **The pure function.** `usableReinforcements(context, held)` returns `[]` for
   `'ranked'` and the list for the other three. The `switch` is exhaustive, so a fifth
   context added to the union is a TypeScript error here rather than a silent grant.
2. **The store the ranked path actually reads.** `app/(game)/searching.tsx` sends
   `placement.arsenal`. Reinforcements are **not `ArsenalItem`s** and there is no store
   action that could put one there — a test walks every action name to prove it.
3. **The wire.** The frozen protocol's `ready` frame has no reinforcement field; a test
   greps the mirror for one.

And a fourth, in SQL: `donation_consume` rejects `p_context = 'ranked'` **explicitly**
rather than by omission, so the intent is legible to whoever reads it next.

---

## 3. What was built

### Pure rules — `src/engine/fleets/`

| File | Owns |
| --- | --- |
| `types.ts` | roles, war states, sizes, the collision header (§6 below) |
| `roles.ts` | §1's permission table, the rank bounds, Admiral succession, joining, roster order |
| `donations.ts` | **the ranked-integrity rule**, the commission price, capacity, the 30-minute cooldown |
| `war.ts` | best-stars-per-target, both tiebreaks, rewards, the state machine, the clock |
| `matchmaking.ts` | opted-in-only rating, the widening window, the give-up |
| `chat.ts` | 24 phrases in four groups, the rate limits, the 7-day expiry, **the single gate** |
| `raidPolicy.ts` | what a raid pays by context — war and friendly settle to nothing |
| `flagHall.ts` | which outcomes earn a flag, and the wall's progress |

### Server

`supabase/migrations/0017_fleets.sql` (§6's nine tables verbatim, plus `war_reward` and
`flags`), `server/src/fleet/{repo,scheduler,routes}.ts`.

### Client

`src/data/countries.ts` (199 countries, the letter index), `src/fleet/api.ts`,
`app/country.tsx`, `app/flag-hall.tsx`.

---

## 4. Free text does not ship

§2 is a scoping decision, not a limitation, and it is worth restating: *"free text means
moderation, reporting and a minor-safety burden nobody has scoped."*

So there is **no free-text path**. Not a disabled one, not one behind a flag check —
none:

- `ChatMessage` has a `code`, not a `text`. The type has no field to put one in.
- `fleet_message.kind` is `check (kind in ('phrase', 'sticker'))` **in the database**.
- `checkSend()` refuses any code that is not a known phrase id or an unlocked sticker
  number — including, specifically, anything that looks like a sentence.
- `/fleet/chat` takes `kind` and `code`. There is no `text` parameter.

The flag exists in the flag list so the **decision** is visible. Turning it on today does
nothing at all, because there is nothing behind it. §7.8's test asserts that as written:
"no path exists", not "is disabled".

---

## 5. Tests (§7, all eight groups)

| § | File | Count |
| --- | --- | --- |
| 1 roles and succession | `tests/fleets/roles.test.ts` | 35 |
| 2 donations + **ranked integrity** | `tests/fleets/donations.test.ts` | 31 |
| 3 matchmaking · 4 war scoring | `tests/fleets/war.test.ts` | 42 |
| 6 friendly · 7 Flag Hall · 8 chat + the picker | `tests/fleets/social.test.ts` | 48 |
| **5 the scheduler** | `server/tests/integration/war-scheduler.test.ts` | 15 |

**171 new tests.** The ones that are doing real work:

- **All 24 cells of §1's table**, transcribed a second time *from the doc* rather than
  from the code, so the two cannot drift. Plus all 16 actor/target pairs for kicking.
- **The reinforcement rule at three levels**, above.
- **The scheduler's five exactly-once cases**: twice, directly twice, mid-settlement
  rollback, a forced-bad claim, and two concurrent ticks.
- **The capacity table against the city catalogue.** `reinforcementCapacity(level)` must
  equal `CITY_CATALOGUE.fleet_hall.levels[level-1].value`. Two tables that must agree, and
  a catalogue edit that did not reach the fleets module would silently change a cap.

### What the tests found

**The country list sorted wrongly.** `'Türkiye' > 'Tuvalu'` in code-point order, so a
plain `<` filed it after Tuvalu — where a player scanning between Tunisia and
Turkmenistan would never look, and would conclude it was missing. Same for Côte d'Ivoire
and São Tomé. Fixed with a diacritic-stripping `sortKey()` used by the list **and** the
letter index, so there is no 'Ü' section either. This was a real picker bug, caught
because the test asserted the property rather than the output.

---

## 6. Decisions (DECISIONS.md D25–D27)

| | |
| --- | --- |
| **D25** | The war chest's scale, which NUMBERS.md does not give. Deliberately modest next to a raid's loot, or raiding becomes the thing you do while waiting for a war. A **draw** pays both sides the loser's share and no gems — §4 does not mention draws, and paying nothing for a 22-hour commitment reads as a bug. |
| **D26** | `src/engine/fleets/` (plural) sits one character from `src/engine/fleet.ts` (the eight ships). I kept the domain word rather than renaming to `squadron`, because the doc, the SQL tables and the endpoints all say *fleet*. Mitigations: loud headers both ways, no shared export names (so a wrong import is a type error), and a test. **This is the decision in Part 8 I am least comfortable with** — it is a real readability risk, and if you would rather have `squadron`, it is a mechanical rename of one directory and one SQL prefix. |
| **D27** | The country list ships bundled, not served: the profile is editable offline, and a served list would let the Flag Hall's denominator change under a player halfway through filling the wall. |

---

## 7. Reuse

Per Part 7's rule, and the instruction's "reuse, do not fork":

- **The Flag Hall** uses `FlagChip` from `src/features/battle/Hud.tsx` — the same chip the
  arena and the leaderboard draw.
- **The country picker** uses the ink kit and **no `TextInput`**: the letter index is the
  navigation, which is the whole design. 199 rows cannot be scrolled and this game has no
  OS keyboard by design.
- **The transport** is `src/net/featureClient.ts`, already shared by the city and the raid.
- **The roster order** comes from the rules (`rosterOrder`), not from a SQL `order by`, so
  merit-first is defined once.
- **Succession** is chosen by `successorFor()` and handed to the SQL, which only applies
  it — the ordering rule has one implementation.

---

## 8. What is NOT built

The plan said: *"If something has to give, it is the screens, not the rules, the server or
the tests — a rule that is right and untested is a rule that will be wrong next month."*
That is what happened. Built and tested: all the rules, all the SQL, the scheduler, the
repo, the Flag Hall, the country picker, and the roster/chat/flags endpoints.

**Not built:**

| Missing | What exists behind it |
| --- | --- |
| `app/fleet.tsx` — the Fleet Hall (roster, chat, donations) | `GET/POST /fleet`, `/fleet/create`, `/fleet/leave`, `/fleet/chat`, and every rule they enforce |
| `app/fleet-browse.tsx` — find/create | `canJoin()` and the policy rules, tested |
| `app/fleet-war.tsx` — prep day, battle day, scoreboard | the whole scheduler, `warScoreboard()`, all the scoring, tested |
| `app/visit.tsx` — the read-only city (§5) | nothing; this one needs a new read endpoint too |
| Donation and war **endpoints** | the rules, the SQL functions (`donation_fill`, `donation_consume`) and the repo methods are all written and typed; only the route handlers are missing |
| Realtime `fleet:{id}` topic | §6 says reuse the emote channel; the RLS policy alongside 0005's two is not written |

**What this means in practice:** a player cannot yet create a fleet from the UI, so none
of the war machinery can be reached by a human. The scheduler is wired into
`server/src/index.ts` and will run, but with no wars in the table it does nothing. The
feature is off by default, so this ships dark and harmless.

**The honest summary:** Part 8 is the largest part in the package and I built its
foundations completely and its surface partially. The next session's work is four screens
and six route handlers against rules that are already proven, which is the cheaper half.

---

## 9. Manual QA — NOT RUN

§7's manual QA ("run a 5v5 war across two devices with the clock shortened by config;
donate and use a reinforcement in a raid; try to use it in a ranked match and confirm it
is absent") **cannot be run yet** — it needs the Fleet Hall screen to create a fleet and
the donation endpoints to donate. It is blocked on §8, not skipped.

Two things it will need when it can run, which do not exist yet:

- **A config override for the war clock.** 22 + 24 hours is untestable by hand. The
  scheduler reads `prep_ends_at` and `battle_ends_at` from the row, so the hook is
  `warSchedule()` — it needs the same `envMs` treatment `server/src/env.ts` already gives
  the room timers.
- **A second device.** The reinforcement half can be done on one; the war cannot.
