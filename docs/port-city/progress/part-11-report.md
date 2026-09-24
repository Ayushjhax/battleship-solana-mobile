# Part 11 — Live world, World Boss and Empire map: implementation report

**Implemented in order:** 11A, then 11B, then 11C. Each deliverable had a green focused
test gate before the next began.

## 11A — living city

- Added pure local-time theme selection with persisted Auto/Day/Night Settings control.
- Kept the one existing `city-port.png`; night recolours that source at runtime and adds a
  deep-blue/pale-ink palette treatment. No second scene asset exists.
- Added two server-window overlays (`winter`, `lantern-festival`) and deterministic rare
  five-minute rain (0–2 passes/day). Rain removes gulls. Rain and the six-second Lighthouse
  sweep unmount under reduced motion.
- All decorative layers are pointer-inert. The pure integrity test applies every decoration
  at once and proves the exact gameplay object is returned unchanged.
- Night palette foregrounds pass the same `contrastRatio >= 3` floor used by the Part 3
  cosmetics papers.

Evidence: `tests/live-world/live-world.test.ts` (10 tests) and
`server/src/__tests__/liveWorld.test.ts` (2 tests), all passing.

## 11B — The Great Armada

- Added a deterministic 30 x 30 generator: 40 halo-separated ships, unique six-cell Flagship,
  mines that grow by wave, and public projections that contain marks but never unresolved ship
  or mine coordinates.
- Added daily allowance rules: five base, Gazette +1, fleet-war +1 each, hard cap ten.
- Added a serialized per-event writer. It replays request ids, resolves a cell once, charges only
  the winner, refunds every collision loser, pays unique milestone keys, and rolls waves while
  still holding the writer.
- Added authenticated feature-gated snapshot/shot routes, a 10-second polling screen, nine taped
  graph-paper sheets, shared marks and explicit loading/error/retry states.
- Added locked-down `0022_world_boss.sql` tables with unique event/wave/cell, request and reward
  keys and no authenticated-client table access.

Concurrency evidence: `server/src/__tests__/worldBoss.concurrency.test.ts` (6 tests) includes the
same-millisecond two-shot case, a 100-call collision (one charge, 99 refunds), idempotent retry,
sixth-shot refusal, reward uniqueness and a wave-completing shot raced by a queued shot.
Engine evidence: `tests/world-boss/world-boss.test.ts` (5 tests), all passing.

## 11C — Empire map

- Added a checksum-shaped catalogue surface of exactly 20 fixed ports in four regions, each with
  a fixed layout, kit, twist, star thresholds and tribute rate.
- Added a connected irregular Kraken, deterministic legal Ghost Fleet relocation every third
  enemy turn (never after a hit), and exact Pirate King inventory (5 AA, 8 mines, 2 decoys).
- Added transcript replay on the server: the client cannot claim a win; the service recomputes
  the result from the port's fixed layout and submitted shots before storing best stars.
- Added the chart screen with four regions, stars and flags, a playable 10 x 10 PvE port board,
  `Empire N%`, and capped/idempotent Customs House collection.
- Added `0023_empire.sql` progress/request tables with RLS and service-role-only writes.
- The campaign engine imports no ranked, renown or arsenal catalogue module.

Evidence: `tests/empire/empire.test.ts` (9 tests) and
`server/src/__tests__/empire.test.ts` (4 tests), all passing. The solver sinks every ship in every
one of the 20 ports. Ghost relocation is swept across 1,000 seeds.

## Verification

| Command | Result |
| --- | --- |
| focused app Part 11 suites + profile | **4 files, 27 tests passed** |
| focused server Part 11 suites | **3 files, 12 tests passed** |
| `cd server && npm run typecheck` | **passed** |
| `npm run lint` | **passed, zero warnings after cleanup** |
| `git diff --check` | **passed** |
| migration replay via existing `city-db.test.ts` | **22 tests passed; all migrations, including 0022/0023, applied twice** |

The app typecheck passed immediately after 11A and again before the last campaign-screen addition.
At the final rerun, unrelated concurrent Part 10 edits changed `PlacementSnapshot`/terrain types and
left five errors in `src/features/battle/setup.ts`, its tests, and `src/raid/ui/useHarbourEditor.ts`.
None is in a Part 11 file. The final full-suite attempt was also blocked by the already-running
development server on TCP 8790: socket integration files timed out when they tried to own the same
listener. Focused Part 11 suites are green; the full sequential regression gate must be rerun after
the external Part 10 edit settles and the dev server is stopped.

## Known limitations / manual QA

- The client currently uses the required 10-second authoritative polling fallback. A realtime
  invalidation broadcast is not wired yet.
- The SQL schema establishes the production uniqueness/RLS boundary, while the running route uses
  the tested in-process serialized reference writer/service. Wiring those routes to the SQL RPC is
  still required before a multi-process production deployment.
- The playable campaign board replays fixed layouts and star conditions, but the current UI does
  not yet animate Ghost fading marks or Pirate King taunts/inventory effects during the battle.
- Android landscape visual QA was not run in this environment. Verify 11A at day/night boundaries
  and reduced motion; collide two authenticated Armada shots against a deployed database; and play
  all three boss ports on device before enabling either production flag.
