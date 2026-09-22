# Port City — design package

Everything behind the *Port city* button in **Empire of Bits: Ocean Warfare**: a real
economy, three new arsenal items, and asynchronous harbour raids, plus the parts that grow
out of those.

Drop this whole folder into the repo at `docs/port-city/` and commit it. The prompts read
from it.

## Start here

| Read | Why |
| --- | --- |
| **`00-OVERVIEW.md`** | The vision, the hard invariants, the conventions and the build order. Nothing else makes sense before it. |
| **`PROMPTS.md`** | The copy-paste prompts for Claude Opus 5 — one per part, plus a repo audit, a hardening sweep and a fix-up template. |
| **`NUMBERS.md`** | Every tuned number on one page. Generated from the reference code; do not hand-edit. |
| **`CORRECTIONS.md`** | Nine findings about the current game design doc, each backed by a test or a simulation. |

## The parts

| File | Part |
| --- | --- |
| `part-01-city-core.md` | Economy, buildings, timers, salvage (rules + server) |
| `part-02-city-screen.md` | The city screen: plots, pen-drawn construction, collecting |
| `part-03-cosmetics.md` | Shipyard and Stationer's Shop — inks, papers, pens, hulls |
| `part-04-bounties-log.md` | Bounty Board contracts and the Captain's Log season |
| `part-05-academy-items.md` | Sonar Net, Decoy Buoy, Minesweeper |
| `part-06-raids-engine.md` | Harbour raids: rules and server |
| `part-07-raids-client.md` | Harbour raids: client, defence log, replays |
| `part-08-fleets.md` | Fleets, donations, wars, visits, the Flag Hall |
| `part-09-gazette-puzzle-voyages.md` | Port Gazette, daily puzzle, trade voyages |
| `part-10-captains-seas.md` | Captains and new seas (terrain) |
| `part-11-live-world.md` | Night and seasons, World Boss, Empire map |

Each part is written to be one implementation session: what the player gets, the exact
rules, the data model, the API, the client work, the edge cases, the telemetry, the tests
that must pass, and the acceptance criteria.

## `reference/`

A working, tested TypeScript model of the new rules — 80 passing tests — plus the three
simulations that produced the numbers in `NUMBERS.md` (raid shell budget, city pacing,
puzzle par). See `reference/README.md`. Run `npm install && npm test` in that folder.

## The short version

Battles pay the city in **salvage**. The city pays battles back in **options, never
power** — the 260-fuel budget and every match rule stay exactly as they are. The harbour
becomes something other captains raid while you sleep, so the layout skill the game
already teaches finally has somewhere permanent to live, and the lobby stops mattering.

If you only build part of it, build **1, 2, 5, 6, 7**.
