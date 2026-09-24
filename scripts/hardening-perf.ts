/**
 * Hardening pass §6 — the performance numbers that CAN be measured without a
 * device, and explicit TODO markers for the ones that cannot.
 *
 * Run from the repo root:
 *   server/node_modules/.bin/tsx --expose-gc scripts/hardening-perf.ts
 *
 * What this measures:
 *   - raid action resolution: per-action engine time across many actions,
 *     p50/p95/max (the floor under the HTTP round trip; the request/DB hop is
 *     NOT included and no device is needed to say so).
 *   - memory delta after 20 full raids, with gc between samples.
 *   - city settle() cost per call, the per-frame work the city screen does
 *     when it re-settles collectors (rough proxy; NOT fps).
 *
 * What it cannot measure, and why:
 *   - City screen fps while panning at 3x with every plot built: requires a
 *     device/emulator and the Reanimated worklet runtime.
 *   - Time to first paint from cache: requires the app bundle + device.
 *   - Real network raid round-trip: requires a socket and the deployed server.
 */
import { performance } from 'node:perf_hooks';

import { generateDefaultHarbour, RAID_DEFAULTS, fireShell, useKit, startRaid, raidView } from '../src/engine/raid';
import { RaidSession } from '../server/src/raid/session';
import { createRng } from '../src/engine/rng';
import { isIsland } from '../src/engine/terrain';
import { CITY_CATALOGUE, maxLevel, newCity, settle } from '../src/engine/city';
import type { BuildingId, BuildingState, CityState, CityWorld } from '../src/engine/city';
import type { Coord } from '../src/engine/types';

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] as number;
}

function heapMb(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    gc();
    gc();
  }
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

// ---------------------------------------------------------------------------
// 1. Raid action resolution
// ---------------------------------------------------------------------------

const rng = createRng(0xbeef);
const layout = generateDefaultHarbour(1234, {
  admiraltyLevel: 6,
  coastalCommandLevel: 6,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
  lighthouseLevel: 4,
});
const kit = { torpedoBomber: 2, doubleTorpedoBomber: 2, bomber: 2, atomicBomber: 1, submarine: 1, radar: 1, minesweeper: 1 };

const samples: number[] = [];
const start = performance.now();
let totalActions = 0;

for (let raid = 0; raid < 20; raid++) {
  let state = startRaid(layout, kit, 0, RAID_DEFAULTS);
  let guard = 0;
  while (!state.over && guard++ < 80) {
    const weapon = (['torpedoBomber', 'bomber', 'submarine', 'radar', 'minesweeper'] as const)[rng.int(5)]!;
    const usedKit = kit[weapon] && rng.int(3) === 0;
    const t0 = performance.now();
    if (usedKit) {
      const row = rng.int(10);
      const at: Coord = { r: rng.int(10), c: rng.int(10) };
      const result =
        weapon === 'torpedoBomber' || weapon === 'minesweeper'
          ? useKit(state, weapon, { row }, 0)
          : useKit(state, weapon, { at }, 0);
      state = result.state;
    } else {
      // Fire at the first unmarked, non-island cell so the action always lands.
      const view = raidView(state, 0);
      let target: Coord | null = null;
      for (let r = 0; r < 10 && !target; r++) {
        for (let c = 0; c < 10 && !target; c++) {
          if (view.marks[`${r},${c}`] === undefined && !isIsland(state.terrain, { r, c })) target = { r, c };
        }
      }
      if (!target) break;
      state = fireShell(state, target, 0).state;
    }
    samples.push(performance.now() - t0);
    totalActions++;
  }
}

const totalMs = performance.now() - start;
samples.sort((a, b) => a - b);

console.log('--- raid action resolution (engine) ---');
console.log(`actions: ${totalActions} across 20 raids`);
console.log(
  `mean ${(samples.reduce((n, s) => n + s, 0) / Math.max(1, samples.length)).toFixed(3)} ms · ` +
    `p50 ${percentile(samples, 50).toFixed(3)} ms · p95 ${percentile(samples, 95).toFixed(3)} ms · ` +
    `max ${(samples[samples.length - 1] ?? 0).toFixed(3)} ms`,
);
console.log(`20 full raids wall: ${totalMs.toFixed(0)} ms`);

// ---------------------------------------------------------------------------
// 1b. Raid action round trip through the real server session (no socket/DB)
// ---------------------------------------------------------------------------

const sessionSamples: number[] = [];
let sessionActions = 0;
for (let raid = 0; raid < 10; raid++) {
  const session = new RaidSession({
    raidId: `perf-${raid}`,
    attackerId: 'perf',
    target: { kind: 'cove', defenderId: null, coveSeed: raid, name: 'Cove', admiraltyLevel: 6, renown: 0 },
    layout,
    kit,
    config: RAID_DEFAULTS,
    now: 0,
  });
  let clock = 0;
  let guard = 0;
  while (!session.over && guard++ < 80) {
    clock += 251; // under the 4/s gate
    const view = session.view(clock);
    let target: Coord | null = null;
    for (let r = 0; r < 10 && !target; r++) {
      for (let c = 0; c < 10 && !target; c++) {
        if (view.marks[`${r},${c}`] === undefined && !isIsland(view.terrain, { r, c })) {
          target = { r, c };
        }
      }
    }
    if (!target) break;
    const t0 = performance.now();
    session.fire(target, clock);
    sessionSamples.push(performance.now() - t0);
    sessionActions++;
  }
}
sessionSamples.sort((a, b) => a - b);
console.log('--- raid action through RaidSession (validation + gate + state) ---');
console.log(
  `${sessionActions} actions: mean ${(sessionSamples.reduce((n, s) => n + s, 0) / Math.max(1, sessionSamples.length)).toFixed(3)} ms · ` +
    `p50 ${percentile(sessionSamples, 50).toFixed(3)} ms · p95 ${percentile(sessionSamples, 95).toFixed(3)} ms · ` +
    `max ${(sessionSamples[sessionSamples.length - 1] ?? 0).toFixed(3)} ms`,
);

// ---------------------------------------------------------------------------
// 2. Memory delta after 20 raids
// ---------------------------------------------------------------------------

const before = heapMb();
for (let raid = 0; raid < 20; raid++) {
  let state = startRaid(layout, kit, 0, RAID_DEFAULTS);
  let guard = 0;
  while (!state.over && guard++ < 80) {
    const view = raidView(state, 0);
    let target: Coord | null = null;
    for (let r = 0; r < 10 && !target; r++) {
      for (let c = 0; c < 10 && !target; c++) {
        if (view.marks[`${r},${c}`] === undefined && !isIsland(state.terrain, { r, c })) target = { r, c };
      }
    }
    if (!target) break;
    state = fireShell(state, target, 0).state;
  }
}
const after = heapMb();
console.log('--- memory ---');
console.log(`heap before ${before} MB · after 20 raids ${after} MB · delta ${(after - before).toFixed(1)} MB`);

// ---------------------------------------------------------------------------
// 3. City settle() — the per-frame pure work behind the city screen
// ---------------------------------------------------------------------------

const day = '2026-01-01';
const now = Date.UTC(2026, 0, 1);
const base = newCity(now, day);
const buildings = {} as Record<BuildingId, BuildingState>;
for (const id of Object.keys(CITY_CATALOGUE) as BuildingId[]) {
  buildings[id] = { level: maxLevel(id), stored: 0, lastAccrualAt: now, carry: 0 };
}
const maxedCity: CityState = { ...base, version: 5, buildings };
const world: CityWorld = {
  city: maxedCity,
  wallet: { coins: 10_000_000, steel: 10_000_000, gems: 10_000 },
};

const settleSamples: number[] = [];
for (let i = 0; i < 2000; i++) {
  const t0 = performance.now();
  settle(world, now + 8 * 24 * 60 * 60 * 1000 + i * 1000);
  settleSamples.push(performance.now() - t0);
}
settleSamples.sort((a, b) => a - b);
console.log('--- city settle (every plot at max) ---');
console.log(
  `2,000 calls: p50 ${percentile(settleSamples, 50).toFixed(4)} ms · ` +
    `p95 ${percentile(settleSamples, 95).toFixed(4)} ms · max ${(settleSamples[settleSamples.length - 1] ?? 0).toFixed(4)} ms`,
);

console.log('--- not measurable in Node ---');
console.log('city screen fps while panning at 3x: needs a device/emulator (worklet + renderer).');
console.log('time to first paint from cache: needs the app bundle on a device.');
console.log('network raid round trip: needs a socket to the deployed server.');
