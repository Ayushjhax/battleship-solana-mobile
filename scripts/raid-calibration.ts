/**
 * Raid calibration against THIS implementation — part-06 §2.
 *
 * The mirror of docs/port-city/reference/sim/raid-calibration.ts, rebuilt on
 * src/engine/raid and driven by THIS repo's AI (src/engine/ai.ts), so the
 * numbers in docs/port-city/reference/out/raid.md can be compared like for
 * like. Run: npx tsx scripts/raid-calibration.ts  (N=1500 by default)
 *
 * THE ONE DIFFERENCE THAT MATTERS. The reference models a 10-ship, 20-cell
 * fleet; this game ships 8 ships and 18 cells (src/engine/fleet.ts). Every
 * destruction figure is therefore over a different denominator and the raid is
 * two cells shorter, so the 3-star rate here is EXPECTED to come out higher
 * than the reference's at the same shell budget. That is the finding, not a
 * discrepancy — see docs/port-city/progress/part-06-report.md.
 *
 * Nothing here is imported by the app or the server.
 */
import { chooseMove } from '../src/engine/ai';
import { specFor } from '../src/engine/arsenal';
import { validateArsenalPlacement } from '../src/engine/placement';
import { autoPlaceFleet } from '../src/engine/placement';
import { createMatch, projectView } from '../src/engine/match';
import {
  RAID_DEFAULTS,
  fireShell,
  kitLeft,
  raidScore,
  retreat,
  startRaid,
  useKit,
  type HarbourLayout,
  type KitCounts,
  type RaidState,
} from '../src/engine/raid';
import { createRng } from '../src/engine/rng';
import type { ArsenalItem, ArsenalKind, Board, Coord, MatchState } from '../src/engine/types';

const RAIDER = 'raider';
const HARBOUR = 'harbour';

interface Defence {
  readonly name: string;
  readonly counts: Partial<Record<ArsenalKind, number>>;
}

interface Kit {
  readonly name: string;
  readonly kit: KitCounts;
}

/** The reference's five, kind for kind. */
const DEFENCES: Defence[] = [
  { name: 'none', counts: {} },
  { name: 'CC1 basic (3 mines, 1 gun)', counts: { mine: 3, aaGun: 1 } },
  { name: 'CC3 basic (5 mines, 2 guns)', counts: { mine: 5, aaGun: 2 } },
  {
    name: 'CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets)',
    counts: { mine: 5, aaGun: 2, decoy: 2, sonar_net: 2 },
  },
  {
    name: 'CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets)',
    counts: { mine: 8, aaGun: 4, decoy: 3, sonar_net: 3 },
  },
];

/** The reference's four. Names mapped onto this engine's ArsenalKind. */
const KITS: Kit[] = [
  { name: 'no kit', kit: {} },
  { name: 'Armory 1 (40)', kit: { bomber: 1, submarine: 1 } },
  { name: 'Armory 3 (80)', kit: { atomicBomber: 1, torpedoBomber: 1 } },
  {
    name: 'Armory 5 (120)',
    kit: { atomicBomber: 1, doubleTorpedoBomber: 1, radar: 1, submarine: 1 },
  },
];

// ---------------------------------------------------------------------------
// A random legal harbour with a given defence loadout
// ---------------------------------------------------------------------------

function randomLayout(seed: number, counts: Partial<Record<ArsenalKind, number>> = {}): HarbourLayout {
  const rng = createRng(seed);
  const ships = autoPlaceFleet(rng);
  const arsenal: ArsenalItem[] = [];

  for (const [rawKind, rawCount] of Object.entries(counts)) {
    const kind = rawKind as ArsenalKind;
    for (let n = 0; n < (rawCount ?? 0); n++) {
      const board: Board = { ships, arsenal, marks: {} };
      for (let attempt = 0; attempt < 200; attempt++) {
        const item: ArsenalItem = {
          id: `${kind}-${n + 1}`,
          kind,
          at: { r: rng.int(10), c: rng.int(10) },
        };
        if (validateArsenalPlacement(board, item).ok) {
          arsenal.push(item);
          break;
        }
      }
    }
  }
  return { ships, arsenal };
}

// ---------------------------------------------------------------------------
// The raid <-> match bridge the AI needs
//
// chooseMove() takes a PlayerView, which is what a real match gives an AI. A
// raid is one-sided, so the harbour is dressed as the defender and the kit as
// the raider's own arsenal — exactly what src/engine/raid/raid.ts does
// internally for the arsenal resolvers.
// ---------------------------------------------------------------------------

function kitAsArsenal(kit: KitCounts): ArsenalItem[] {
  const items: ArsenalItem[] = [];
  for (const [rawKind, count] of Object.entries(kit)) {
    for (let n = 0; n < (count ?? 0); n++) {
      items.push({ id: `${rawKind}-${n + 1}`, kind: rawKind as ArsenalKind });
    }
  }
  return items;
}

function viewFor(state: RaidState, kitItems: readonly ArsenalItem[]) {
  const base = createMatch({ id: 'sim', mode: 'advanced', seed: 1, playerIds: [RAIDER, HARBOUR] });
  const match: MatchState = {
    ...base,
    phase: 'playing',
    turn: RAIDER,
    players: [
      {
        ...base.players[0],
        board: { ships: [], arsenal: kitItems, marks: {} },
        ready: true,
      },
      {
        ...base.players[1],
        board: { ships: state.ships, arsenal: state.arsenal, marks: state.marks },
        ready: true,
      },
    ],
  };
  return projectView(match, RAIDER);
}

// ---------------------------------------------------------------------------
// One raid
// ---------------------------------------------------------------------------

interface RaidResult {
  readonly stars: 0 | 1 | 2 | 3;
  readonly destruction: number;
  readonly shellsLeft: number;
  readonly reason: string;
  readonly shotsFired: number;
}

function runRaid(
  seed: number,
  defence: Defence,
  kit: Kit,
  shells: number,
  difficulty: 'normal' | 'hard',
): RaidResult {
  const layout = randomLayout(seed, defence.counts);
  let state = startRaid(layout, { ...kit.kit }, 0, {
    ...RAID_DEFAULTS,
    shells,
    timeLimitMs: Number.MAX_SAFE_INTEGER,
  });
  const rng = createRng(seed ^ 0x9e37_79b9);

  // The AI's own arsenal, so it knows which weapons it is holding. Items are
  // marked used as the raid spends them.
  const kitItems = kitAsArsenal(kit.kit);
  const spent = new Set<string>();
  let shots = 0;

  for (let guard = 0; !state.over && guard < 400; guard++) {
    const live = kitItems
      .filter((i) => !spent.has(i.id))
      .map((i) => ({ ...i }));

    let action;
    try {
      action = chooseMove(viewFor(state, live), difficulty, rng);
    } catch {
      // No unknown cells left: nothing legal remains.
      state = retreat(state);
      break;
    }

    if (action.type === 'USE_ARSENAL') {
      const item = live.find((i) => i.id === action.itemId);
      if (!item) {
        spent.add(action.itemId);
        continue;
      }
      const out = useKit(state, item.kind, {
        ...(action.at ? { at: action.at } : {}),
        ...(action.row !== undefined ? { row: action.row } : {}),
      });
      spent.add(item.id);
      // A rejected weapon is still spent for the simulation, so it cannot loop.
      if (!out.error) state = out.state;
      continue;
    }

    if (action.type !== 'FIRE') {
      state = retreat(state);
      break;
    }

    if (state.shells <= 0) {
      if (kitLeft(state) === 0) break;
      // Shells gone but a plane is left: fly it (§6 keeps the raid alive).
      const weapon = (Object.keys(state.kit) as ArsenalKind[]).find((k) => (state.kit[k] ?? 0) > 0);
      if (!weapon) break;
      const spec = specFor(weapon);
      const out = useKit(
        state,
        weapon,
        spec.target === 'row' ? { row: action.at.r } : { at: action.at },
      );
      state = out.error ? { ...state, kit: { ...state.kit, [weapon]: 0 } } : out.state;
      continue;
    }

    const out = fireShell(state, action.at);
    if (out.error) break;
    state = out.state;
    shots++;
  }

  const score = raidScore(state);
  return {
    stars: score.stars,
    destruction: score.destruction,
    shellsLeft: state.shells,
    reason: state.endReason ?? 'unknown',
    shotsFired: shots,
  };
}

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

const N = Number(process.env.N ?? 1500);
const pct = (n: number, total: number) => `${((100 * n) / total).toFixed(0)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const lines: string[] = [];
lines.push(`# Raid calibration — THIS implementation (${N} raids per row)`);
lines.push('');
lines.push(
  '> Fleet: 8 ships / 18 cells (src/engine/fleet.ts). The reference used 10 ships / 20 cells.',
);
lines.push('');

lines.push('## A. Shots needed to clear an undefended harbour');
lines.push('');
lines.push('| Raider | median shots | mean shots | mean misses |');
lines.push('| --- | --- | --- | --- |');
for (const difficulty of ['normal', 'hard'] as const) {
  const shots: number[] = [];
  const misses: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = runRaid(1_000 + i, DEFENCES[0]!, KITS[0]!, 999, difficulty);
    shots.push(r.shotsFired);
    misses.push(999 - r.shellsLeft);
  }
  shots.sort((a, b) => a - b);
  lines.push(
    `| ${difficulty} | ${shots[Math.floor(shots.length / 2)]} | ${mean(shots).toFixed(1)} | ${mean(misses).toFixed(1)} |`,
  );
}

lines.push('');
lines.push('## B. Star distribution by shell budget (Normal raider, Armory 3 kit)');
lines.push('');
lines.push('| Defence | shells | 0★ | 1★ | 2★ | 3★ | mean destruction |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const defence of DEFENCES) {
  for (const shells of [24, 28, 30, 34, 40]) {
    const stars = [0, 0, 0, 0];
    let destruction = 0;
    for (let i = 0; i < N; i++) {
      const r = runRaid(5_000 + i, defence, KITS[2]!, shells, 'normal');
      stars[r.stars]!++;
      destruction += r.destruction;
    }
    lines.push(
      `| ${defence.name} | ${shells} | ${pct(stars[0]!, N)} | ${pct(stars[1]!, N)} | ${pct(stars[2]!, N)} | ${pct(stars[3]!, N)} | ${((100 * destruction) / N).toFixed(0)}% |`,
    );
  }
}

lines.push('');
lines.push('## C. Star distribution by kit at 30 shells');
lines.push('');
lines.push('| Defence | kit | raider | 0★ | 1★ | 2★ | 3★ | mean destruction |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const defence of DEFENCES) {
  for (const kit of KITS) {
    for (const difficulty of ['normal', 'hard'] as const) {
      const stars = [0, 0, 0, 0];
      let destruction = 0;
      for (let i = 0; i < N; i++) {
        const r = runRaid(9_000 + i, defence, kit, 30, difficulty);
        stars[r.stars]!++;
        destruction += r.destruction;
      }
      lines.push(
        `| ${defence.name} | ${kit.name} | ${difficulty} | ${pct(stars[0]!, N)} | ${pct(stars[1]!, N)} | ${pct(stars[2]!, N)} | ${pct(stars[3]!, N)} | ${((100 * destruction) / N).toFixed(0)}% |`,
      );
    }
  }
}

lines.push('');
lines.push('## D. What each defence item is worth (Normal raider, Armory 3 kit, 30 shells)');
lines.push('');
lines.push('| Harbour | mean destruction | 3★ rate |');
lines.push('| --- | --- | --- |');
const SINGLES: Defence[] = [
  { name: 'bare fleet', counts: {} },
  { name: '+3 mines', counts: { mine: 3 } },
  { name: '+5 mines', counts: { mine: 5 } },
  { name: '+8 mines', counts: { mine: 8 } },
  { name: '+1 gun', counts: { aaGun: 1 } },
  { name: '+3 guns', counts: { aaGun: 3 } },
  { name: '+2 decoys', counts: { decoy: 2 } },
  { name: '+3 decoys', counts: { decoy: 3 } },
  { name: '+2 nets', counts: { sonar_net: 2 } },
  { name: '5 mines + 2 guns + 2 decoys', counts: { mine: 5, aaGun: 2, decoy: 2 } },
];
for (const defence of SINGLES) {
  let destruction = 0;
  let three = 0;
  for (let i = 0; i < N; i++) {
    const r = runRaid(13_000 + i, defence, KITS[2]!, 30, 'normal');
    destruction += r.destruction;
    if (r.stars === 3) three++;
  }
  lines.push(
    `| ${defence.name} | ${((100 * destruction) / N).toFixed(0)}% | ${pct(three, N)} |`,
  );
}

process.stdout.write(`${lines.join('\n')}\n`);
