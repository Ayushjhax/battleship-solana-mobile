# Part 11 — Live world, World Boss and Empire map: implementation plan

**Status:** implementation plan; no Part 11 code existed when this was written.
**Order is fixed:** 11A must be green before 11B starts; 11B must be green before 11C starts.

## 0. Read and mapped first

Read before this plan: `part-11-live-world.md`, `00-OVERVIEW.md`, `progress/REPO-MAP.md`,
the Part 2 and Part 6 reports, `CORRECTIONS.md`, `NUMBERS.md`, `DECISIONS.md`, the real
city renderer/settings/profile store, the cosmetics contrast rules, raid service/repository,
feature flags, migration harness, and Expo SDK 57 documentation.

The real tree wins over the old repo map:

- pure shared rules are under `src/engine/`; Vitest discovers both colocated engine tests and
  `tests/**`;
- the city is already a real pan/zoom React Native scene in `app/city.tsx`, with additive
  vector layers under `src/city/ui/`, a single `city-port.png` asset, and reduced-motion-aware
  ambient animation;
- durable local settings live in `src/state/profile.ts`; Part 11A's day/night preference belongs
  there, not in city state or server state;
- server flags already include `portCity.worldBoss` and `portCity.empire`, default off;
- server services use an injectable repository seam and Fastify route modules; transaction-heavy
  invariants live in SQL migrations and are exercised twice with PGlite;
- no general gameplay realtime client exists. Supabase channels are used for lobby presence/chat.
  The World Boss will use a private event channel when available and retain the required 10 s
  snapshot poll as its authoritative fallback;
- the worktree contains extensive uncommitted work from Parts 1–10. Part 11 will preserve it and
  make additive changes; overlapping edits to `app/city.tsx`, `app/settings.tsx`, profile state,
  server registration and feature flags will be minimal.

The first attempted baseline mistakenly ran app and server suites concurrently; their integration
tests contend for the same local listener and timed out. Baselines and all gates below are run
**sequentially**. This is an execution constraint, not a product failure.

## 1. Decisions forced by numbers the brief leaves approximate

These are recorded in `DECISIONS.md` with implementation, because the overview says never to hide
an invented number.

1. **Season overlays:** ship `winter` (snow hatching) and `lantern-festival` (lantern strings and
   warm festival dots). Both are server-configured UTC `[startsAt, endsAt)` windows; overlaps are
   allowed and render in catalogue order.
2. **Rare weather:** deterministic per local calendar day: zero, one or two five-minute rain
   windows derived from a public daily seed. It is cosmetic, unmounted under reduced motion, and
   never read by an engine or server mutation.
3. **World Boss seed:** 40 ships per wave. Wave 1 uses lengths `6 x1, 5 x3, 4 x6, 3 x10, 2 x20`;
   later waves preserve 40 ships and add mines (`8 + 2 * (wave - 1)`, capped at 30). Placement is
   deterministic with a bounded retry and the normal one-cell halo.
4. **World Boss rewards:** contribution tiers at 1/10/25 resolved hits; milestone rewards at the
   specified 25/50/75/100%; the Flagship payout is gems. Exact award amounts are catalogue data,
   checksum-pinned, and deliberately do not include rank or renown.
5. **Extra shots:** Gazette grants at most one daily extra; completed fleet-war raids grant one
   each; total daily allowance is `min(10, 5 + extras)`. Extras are server facts, never client
   claims.
6. **Empire:** exactly 20 ports, five in each of four regions. The first three regions end in the
   specified bosses; the fourth ends in a hard conventional fortress so there are exactly three
   special region bosses as written.
7. **Tribute:** each conquered port contributes catalogue-defined coins/steel per UTC day;
   uncollected accrual is capped at 24 hours and the all-20 rate is capped at the documented
   equivalent of roughly one Foundry level. Collection requires the Customs House plot and is one
   idempotent server transaction.

## 2. Deliverable 11A — living city

### Pure rules and state

Add `src/engine/liveWorld/`:

- `theme.ts`: `CityTimePreference = 'auto' | 'day' | 'night'`, local-hour night selection
  (`19:00 <= hour || hour < 06:00`), and day/night palettes;
- `seasons.ts`: validated date-window configuration and active-overlay selection;
- `weather.ts`: seeded daily rain windows and `weatherAt(now, localDate, seed)`;
- `integrity.ts`: an explicit decoration projection whose input/output contains no gameplay state.

Extend the persisted profile with the time preference and a three-way Settings control. Versioned
profile migration defaults existing users to `auto`.

### Rendering

- Keep the single `city-port.png`. Apply one native colour-matrix/tint treatment to that same
  source in night mode; vector buildings and all ink layers receive a context palette swap.
- Add `LivingWorldLayer` inside the existing transformed map: seasonal sprite/vector overlays,
  rare rain dashes, gull suppression in rain, warm window dots, and the Lighthouse beam on a 6 s
  sweep. Every decorative layer has `pointerEvents="none"`.
- Reduced motion removes rain and the sweeping beam; static night recolouring and static seasonal
  decoration remain.
- Extend server config with validated season windows. If config is absent, the overlay list is
  empty; night still follows the local device hour by design.

### 11A tests and gate

- boundary tests at 05:59/06:00/18:59/19:00 plus all three overrides;
- deterministic season-window and weather tests (including 0/1/2 windows and five-minute bound);
- structural asset test proving both themes reference the same scene asset;
- gameplay-integrity differential: identical city/gameplay inputs under every decoration state
  produce byte-identical rules output;
- reuse Part 3's `contrastRatio`/legibility sweep for every night ink, mark and paper/background
  combination at the same floors;
- renderer budget, reduced-motion unmount, pointer-event and Settings persistence tests;
- run targeted 11A tests, then full app tests, typecheck and lint before beginning 11B.

## 3. Deliverable 11B — The Great Armada

### Pure engine

Add `src/engine/worldBoss/`:

- typed 30 x 30 coordinates, public cell marks and secret seeded layout;
- deterministic 3 x 3 taped-sheet geometry metadata (10 x 10 cells each);
- seeded fleet/mine generator, including the unique six-cell `flagship`;
- pure cell resolution, sink-credit fan-out, contribution/milestone calculations and wave
  generation;
- projection functions that expose marks, progress and sunk/public metadata but can never include
  unresolved ship or mine cells.

### Persistence and serialized writer

Migration `0022_world_boss.sql` adds event, wave, hidden-cell, public-mark, participant,
contribution, shot-ledger and reward-ledger tables plus one security-definer RPC that is the
**only writer**.

The RPC locks the active event row (`FOR UPDATE`) and then:

1. replays a prior `requestId` response;
2. settles the UTC daily allowance from base/Gazette/fleet-war server records;
3. checks the active wave under the lock;
4. inserts the cell resolution with a unique `(event_id, wave, row, col)` key;
5. if already resolved, returns `refunded: true` without decrementing allowance;
6. otherwise charges exactly one shot, resolves/sinks, inserts once-only reward ledger entries,
   and rolls the wave over under the same lock when complete;
7. returns only the public snapshot and `serverNow`.

Lock ordering is event then participant then cell/reward rows everywhere. This intentionally
serializes shots per event: correctness is the feature. SQL contains no rank/renown columns and
the route is free.

### Server and client

- `server/src/worldBoss/{repo,service,routes,config}.ts`; all routes are authenticated and return
  `feature-off` while the flag is off;
- GET snapshot and POST shot; service accepts injected repo/time for unit tests;
- broadcast a lightweight `world-boss:changed` invalidation after commit; the client refetches.
  It also refetches every 10 s while open and immediately on foreground/reconnect;
- `app/world-boss.tsx` renders the 30 x 30 board as nine graph-paper sheets with tape seams,
  zoom/pan, shared marks, wave progress, allowance and reward state. Loading/empty/error/offline
  states are explicit and retries never optimistically spend a shot.

### 11B tests and gate

- engine generation determinism, 30 x 30 bounds, 40-ship composition, Flagship length and
  projection secrecy;
- **hard concurrency suite:** many parallel calls to the same cell resolve once; exactly one call
  is charged and every loser is refunded; repeat across many cells/request ids;
- same-millisecond two-shot required case;
- wave-completing shot racing another shot: one rollover, consistent old/new wave responses, no
  shot charged against the wrong wave;
- milestone and Flagship rewards once per eligible player/wave under parallel retries;
- five base shots reject the sixth; validated extras lift but never exceed ten;
- idempotency, auth isolation, feature-off, no-entry-cost and SQL structural checks for no ranked
  or renown mutation;
- client reducer/store tests for polling, invalidation, refund and stale-wave responses;
- run targeted 11B app/server/PGlite suites, then both full suites **sequentially**, typechecks and
  lint before beginning 11C.

## 4. Deliverable 11C — Empire map

### Pure campaign engine

Add `src/engine/empire/`:

- checksum-pinned catalogue of exactly 20 handcrafted ports in four regions: fixed layouts,
  fixed kits, twists, star thresholds and tribute rates;
- campaign-only board types and adapters. Ranked/classic types, arsenal catalogue and fuel budget
  remain untouched;
- arbitrary connected polyomino ship support scoped to the PvE board; halo, hit and sink helpers;
- Ghost Fleet relocation hook every third **enemy** turn: only wholly un-hit ghost ships, only
  legal positions, deterministic candidate order from seed, old marks emitted as fading render
  metadata rather than retained hits;
- Pirate King fixed five AA guns, eight mines and two decoys plus taunt events;
- deterministic scripted solver used to prove every catalogue port is winnable;
- stars and capped tribute accrual/collection rules.

### Persistence, server and client

- migration `0023_empire.sql`: per-user port progress/best stars, tribute cursor/cap, request and
  economy ledgers. RLS denies direct client writes; collection is an idempotent RPC;
- `server/src/empire/{repo,service,routes}.ts`, gated by `portCity.empire`; server validates a
  submitted PvE action transcript by replaying the pure engine before saving stars;
- `app/empire.tsx`: zoomable hand-drawn chart, four regions, 20 selectable ports, locked paths,
  stars, three boss silhouettes and the player's flag over conquered ports;
- Customs House becomes a real city plot/interaction only while Empire is enabled. It shows
  accrued/capped tribute and collects the authoritative snapshot; no client-computed balance;
- progress copy is `Empire N%`, calculated from conquered ports.

### 11C tests and final gate

- catalogue shape/checksum and scripted solver victory for all 20 ports;
- every one/two/three-star boundary;
- polyomino connectivity, halo, hits and sink correctness;
- thousands of seeded Ghost relocations: legal only, on schedule only, never a hit ship, no overlap
  or halo violation, deterministic replay;
- Pirate King inventory exactness;
- tribute accrual, 24 h/all-port cap, idempotent collection and concurrent collection once;
- structural/differential isolation: campaign exports cannot import ranked rewards, renown or the
  arsenal catalogue; running campaign actions leaves those snapshots byte-identical;
- route auth, user isolation, feature-off, migration rerun and RLS tests;
- map/store render-state tests and conquered-flag/Customs House tests;
- targeted tests, full app/server tests sequentially, both typechecks, lint and coverage for all
  new pure modules.

## 5. Expected files

New groups: `src/engine/{liveWorld,worldBoss,empire}/`, `src/worldBoss/`, `src/empire/`,
`server/src/{worldBoss,empire}/`, `app/{world-boss,empire}.tsx`, migrations 0022/0023, and focused
tests under the matching app/server test trees.

Existing overlap: `app/city.tsx`, `app/settings.tsx`, `src/state/profile.ts`, city palette/layers,
`src/net/api.ts`, `server/src/{index,features}.ts`, city plot catalogue/UI, and migration test
helpers. No existing test will be deleted or weakened.

## 6. Manual QA and report

The report will separate 11A, 11B and 11C test evidence. Automated rendering/contrast and
responsive checks will run locally. Real-device Android landscape QA will only be marked passed if
it is actually run; otherwise the report will name it as an open manual step rather than fabricate
evidence. Finish in `docs/port-city/progress/part-11-report.md` with built/deviated/open sections,
commands/results, migration notes and a hand-test script.
