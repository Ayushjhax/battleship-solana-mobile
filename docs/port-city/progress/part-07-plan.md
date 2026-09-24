# Part 7 — Harbour raids: the client. Implementation plan

**Read:** `part-07-raids-client.md`, `part-06-raids-engine.md`, `00-OVERVIEW.md`,
`progress/REPO-MAP.md`, `progress/part-02-report.md`, `progress/part-06-report.md`.

**Flag:** `portCity.raids`, default off. Off = today's app exactly, including the city
harbour nameplate reverting to its stats card.

---

## 0. The constraint that shapes everything: there is no React renderer in the tests

`vitest.config.ts` runs `environment: 'node'` with **no React renderer**, and anything
imported from a `.tsx` fails to parse (Flow). Part 2 hit this and solved it by putting
every decision a test needs to make into a **pure `.ts` module** beside the component
(`budgets.ts`, `plotState.ts`, `tourScript.ts`, `captainCopy.ts`).

Part 7's test list (§8) is almost entirely behavioural — "the refund fires on hit, not on
miss", "scrubbing reproduces the same board", "revenge skips the cost exactly once". So
the same split, harder:

| Pure module (tested) | Component (thin) |
| --- | --- |
| `src/raid/ui/shellHud.ts` | `ShellRow.tsx` |
| `src/raid/ui/replayScrub.ts` | `ReplayViewer.tsx` |
| `src/raid/ui/firstRaid.ts` | `RaidTour.tsx` |
| `src/raid/ui/defenceBudget.ts` | the placement shop |
| `src/raid/ui/captainCopy.ts` | every error toast |
| `src/raid/ui/defenceLog.ts` | `DefenceLog.tsx` |

**Rule I am holding myself to:** if a `.tsx` file contains an `if` that decides a game
outcome, it is in the wrong file.

---

## 1. Reuse map — exactly what I am reusing, and the prop I add to each

The instruction is "reuse, do not fork: if a component needs a prop to serve both, add the
prop". Here is every one, with the prop.

### The defence editor **is** `app/(game)/placement.tsx`

No new screen. Three additions, all in the **store**, so the screen reads them the way it
already reads `fuelBudget`:

| Addition | Where | Why |
| --- | --- | --- |
| `PlacementMode` gains `'harbour'` | `src/state/placement.ts` | the screen already branches on `mode` for the classic/advanced layout and the hotseat handoff |
| `allowedKinds?: readonly ArsenalKind[]` | `PlacementData` | §2.2 "the shop only offers own-board items" — `ShopPanel` already reads the store, so it filters itself |
| `kindCaps?: Partial<Record<ArsenalKind, number>>` | `PlacementData` | Coastal Command caps, which `specFor(kind).max` cannot express because they vary by building level |
| `fuelLabel?: string` | `PlacementData` | §2.1 "Harbour fuel 74 / 90" instead of "Fuel 74 / 260" |

`initialize()` gains an options bag. `buyArsenal()` consults `allowedKinds`/`kindCaps`
before `purchaseArsenalItem()` — **one added guard, not a second code path**.

Shuffle, Reset, drag, rotate, the unsaved-changes guard and `sellPlacedArsenal()` are
untouched and work as they do today. Read-only-while-under-attack is one new prop on the
screen (`readOnly`) that disables the gesture detectors and draws the ink banner —
the same shape as the existing `tutorial` prop.

### The raid board **is** `GridBoard` + the battle FX stack

`DualBoards` draws two boards; a raid has one. But `DualBoards` is itself a thin wrapper
over **`GridBoard`**, so the raid screen uses `GridBoard` directly — the same component,
one layer down, not a copy of it. Reused unchanged:

- `GridBoard` (`cells`, `revealed`, `wrecks`, `highlight`, `animateMarks`, `seedKey`)
- `FxLayer` + `useFx` + `createBattleEffects` — **every animation from §13.2, unchanged**
- `EventPlayer` — the raid's server events are `MatchEvent[]`, the same union
- `ArsenalTab` and `BattleArsenalPopover` — §3 "the red Arsenal tab, as in a match"
- `ArsenalTargetingOverlay` — arming a kit weapon

The board is drawn larger by wrapping it in a `scale` transform (§3 "centred and larger
than in a match"). One number, `RAID_BOARD_SCALE`, not a second geometry.

### The result **is** `app/(game)/result.tsx`'s parts

The match result screen is about rank points and wagers, which a raid has none of. What
it owns that a raid needs are three things that are currently **private functions inside
the file**, so I export them rather than re-implement them:

- `useRoll(from, to, delay, ms)` — the counter roll
- `Coin` — the coin that flies into a counter
- `Laurel` — the win flourish

Plus `TitleRibbon`, `InkPanel`, `InkButton`, `CurrencyChip`, `RankBadge` from `src/ui`,
which are already shared.

### The city entry point

`HomeHarbour` in `app/city.tsx` already takes `onPress`. Flag on: it routes to
`/harbour`. Flag off: it keeps today's behaviour (centre the map) and today's record line.
**One conditional, in the callback, not in the component.**

---

## 2. The four screens

```
app/harbour.tsx            §1  your harbour
app/(game)/placement.tsx   §2  the defence editor  (mode='harbour')
app/(game)/raid.tsx        §3  kit → search → raid → result
app/harbour-log.tsx        §4  defence log + revenge
app/raid-replay.tsx        §5  replay viewer
```

`app/(game)/raid.tsx` is one route with four **steps**, not four routes, because the kit
and the search are both thrown away if the player backs out and the raid must not survive
a route change it did not settle. Step is local state; the raid id lives in the store.

### §3 step 3, the shell HUD

The number rendered is **always `view.shells` from the server**. The animation is a
separate, purely visual layer driven by `shellHud.ts`:

```ts
// pure, tested
export function shellFeedback(before: number, after: number, mine: boolean): ShellFeedback
//   -> { kind: 'refund' | 'spend' | 'mine', delta, flash: boolean }
```

A refund pops when `after === before` on a resolved shot (a hit or a decoy gave it back),
a mine flashes red for `-1 - minePenalty`, a miss just decrements. **The component never
adds or subtracts** — it is handed two server numbers and asked what to draw. That is
what makes §8.2 testable without a renderer.

---

## 3. The client data layer — `src/raid/`

Mirrors `src/city/` exactly (Part 1), because it already solved this:

```
src/raid/types.ts     zod schemas for every response + typed error codes
src/raid/api.ts       requestId on every mutation, retries on NETWORK only
src/raid/store.ts     the last server payload, and nothing computed
src/raid/ui/*.ts      the pure modules from §0
```

`api.ts` is a near-copy of `src/city/api.ts` in shape but **not a fork of its transport**:
the retry/timeout/offline plumbing is lifted into `src/net/featureClient.ts` and both use
it. That is one refactor of existing code, and it is the kind the instruction asks for
(add the seam rather than duplicate).

**Hard rule enforcement:** `RaidView` from the server has no layout field (Part 6 made
that structural). The client's zod schema mirrors that — it has no `ships`, no `arsenal`,
no `layout`. A server that somehow sent one would have it **stripped at the parse
boundary**, and a test asserts the schema rejects it.

---

## 4. A raid never ends without a result the player can see

Three failure paths, and what each does:

| What happened | What the player sees |
| --- | --- |
| Retreat | confirm → settle → result |
| Shells out / cleared / clock | settle → result |
| **App backgrounded > 60 s** | on return: `GET /raid/status` says no active raid → fetch the settled raid → **result screen**, not a dead board |
| Network drops mid-raid | the ConnectionOverlay (reused), then on reconnect the same status probe |
| Settle request fails | retry, then a Captain panel with **"See the outcome"** which re-probes |

The status probe is the single mechanism; `AppState` `active` and reconnect both call it.
There is no path that leaves the raid screen showing a board with no result.

---

## 5. The scripted first raid (§7)

```ts
// src/raid/ui/firstRaid.ts — pure
export const FIRST_RAID = {
  coveSeed: 20_260_923,          // fixed
  defence: { mine: 3, aaGun: 1 },
  rewardSteel: 300,              // fixed
  beats: [...4 Captain beats...],
} as const;
export function firstRaidBeat(view, seenBeats): Beat | null
```

Four beats, each fired by a **condition on the server payload**, not by a step counter:
shells-and-refund (first hit), the mine penalty (first mine), the arsenal tab (kit held and
unused after 6 shells), the stars (first star earned).

"It never runs twice" is a profile flag, `hasRaided`, set when the first raid **settles**
— not when it starts, so a player who backgrounds out of it gets it again. The 300 steel
is paid by the server on that raid's settlement, so the client never credits it.

---

## 6. The replay viewer (§5)

The hard requirement is "skipping and scrubbing must never desync: rebuild the state from
action 0 to the target index rather than trying to rewind".

```ts
// src/raid/ui/replayScrub.ts — pure, and the whole of §8.5
export function stateAt(layout, kit, actions, config, index): RaidState
```

It calls the **engine's own `replayRaid`** with `actions.slice(0, index)`. No incremental
rewind exists to get wrong. A memo caches the last index so scrubbing forward by one does
not re-run 30 actions, but the cache is keyed on the action list — a miss just recomputes.

---

## 7. Tests (§8, in full)

| § | Test | File |
| --- | --- | --- |
| 8.1 | budget maths, caps, invalid save → copy, read-only, unsaved guard | `tests/raid/defenceEditor.test.ts` |
| 8.2 | refund on hit not miss, number is the server's, mine shows −3 | `tests/raid/shellHud.test.ts` |
| 8.3 | stars/destruction render from the payload only | `tests/raid/shellHud.test.ts` |
| 8.4 | retreat settles; **backgrounded 90 s** settles and shows the outcome | `tests/raid/raidFlow.test.ts` |
| 8.5 | scrub to any index == play straight through; missing replay → note | `tests/raid/replay.test.ts` |
| 8.6 | revenge skips the search cost exactly once per incoming raid | `tests/raid/defenceLog.test.ts` |
| 8.7 | first-raid script runs once, is skippable, pays once | `tests/raid/firstRaid.test.ts` |
| — | **double-tap collect** (§8 QA) and a **slow connection** | `tests/raid/raidFlow.test.ts` |
| — | flag off = no raid surface anywhere | `tests/raid/flagOff.test.ts` |

The slow-connection and backgrounding tests drive the real `api.ts` against a stubbed
`fetch` with injected delays — the same technique `tests/net/*.test.ts` already uses.

---

## 8. Risks

1. **`placement.tsx` is 1,654 lines** and the defence editor touches it. Mitigation: every
   change is additive and mode-guarded, and the existing placement tests
   (`src/state/__tests__/placement.test.ts`) must stay green untouched — they are the
   regression net for "I did not break the match path".
2. **`result.tsx` exports.** Exporting three private functions changes nothing at runtime,
   but it widens the file's surface. I will export them explicitly rather than
   `export *`, and say so in the report.
3. **The status probe could loop** if the server keeps saying "no active raid" and the
   client keeps asking. One probe per `AppState` transition, and a single retry.
4. **Part 6 has no `GET /raid/replay` endpoint** — §5 needs one. It is a read of
   `raid_log` and a `buildReplay()` call, both of which already exist; I will add the
   route rather than leave the viewer unreachable.
