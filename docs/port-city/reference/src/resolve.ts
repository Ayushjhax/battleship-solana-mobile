// Shot + arsenal resolution. Existing rules follow the shipped engine (doc §5,
// §7, §8, §9); the sonar net, decoy buoy and minesweeper are Part 5 of the Port
// City design.

import {
  Board,
  Cell,
  ItemKind,
  Mark,
  Ship,
  SIZE,
  haloOf,
  inGrid,
  isMarked,
  isSunk,
  key,
  liveItemAt,
  shipAt,
} from './grid.js';

export type Outcome =
  | 'illegal' // already marked - the UI never allows it
  | 'miss'
  | 'hit'
  | 'sunk'
  | 'mine'
  | 'item_destroyed'
  | 'decoy_hit'
  | 'skipped'; // inside a weapon footprint, cell was already marked

export type Resolution = {
  cell: Cell;
  outcome: Outcome;
  shipId?: string;
  shipClass?: string;
  itemKind?: ItemKind;
  revealed?: Cell[]; // halo cells hatched by a sink
};

const setMark = (b: Board, c: Cell, m: Mark) => {
  b.marks[c.r][c.c] = m;
};

/** Auto-reveal (doc §5.2): every unknown halo cell of a sunk ship is proven empty. */
function autoReveal(b: Board, ship: Ship): Cell[] {
  const out: Cell[] = [];
  for (const h of haloOf(ship.cells)) {
    if (isMarked(b.marks[h.r][h.c])) continue;
    setMark(b, h, 'revealed');
    out.push(h);
    const item = liveItemAt(b, h);
    if (item && item.kind === 'mine') item.state = 'neutralised';
    // AA guns / sonar nets in a halo stay live but can never be shot (known gap,
    // doc Appendix C). Radar stays usable.
  }
  return out;
}

/** A decoy is exposed once every orthogonal neighbour it has is marked. */
function checkDecoyExposure(b: Board) {
  for (const d of b.layout.items) {
    if (d.kind !== 'decoy' || d.state !== 'hit') continue;
    const n: Cell[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) {
          const c = { r: d.cell.r + dr, c: d.cell.c + dc };
          if (inGrid(c)) n.push(c);
        }
    if (n.every((x) => isMarked(b.marks[x.r][x.c]))) {
      d.state = 'exposed';
      setMark(b, d.cell, 'decoy');
    }
  }
}

/**
 * Resolve one cell exactly as a plain shot does.
 * `viaTorpedo` is used by torpedo runs, which only ever land on intact ship or
 * decoy cells and never trigger mines.
 */
export function resolveCell(b: Board, cell: Cell, opts: { inFootprint?: boolean } = {}): Resolution {
  if (!inGrid(cell)) return { cell, outcome: 'skipped' };
  if (isMarked(b.marks[cell.r][cell.c]))
    return { cell, outcome: opts.inFootprint ? 'skipped' : 'illegal' };

  const mine = liveItemAt(b, cell);
  if (mine && mine.kind === 'mine') {
    mine.state = 'spent';
    setMark(b, cell, 'mine');
    checkDecoyExposure(b);
    return { cell, outcome: 'mine', itemKind: 'mine' };
  }

  const ship = shipAt(b, cell);
  if (ship) {
    const i = ship.cells.findIndex((x) => x.r === cell.r && x.c === cell.c);
    ship.hit[i] = true;
    setMark(b, cell, 'hit');
    if (isSunk(ship)) {
      for (const c of ship.cells) setMark(b, c, 'sunk');
      const revealed = autoReveal(b, ship);
      checkDecoyExposure(b);
      return { cell, outcome: 'sunk', shipId: ship.id, shipClass: ship.cls, revealed };
    }
    checkDecoyExposure(b);
    return { cell, outcome: 'hit', shipId: ship.id, shipClass: ship.cls };
  }

  const item = liveItemAt(b, cell);
  if (item && item.kind === 'decoy') {
    item.state = 'hit';
    setMark(b, cell, 'hit'); // the lie: the attacker sees an ordinary hit
    checkDecoyExposure(b);
    return { cell, outcome: 'decoy_hit', itemKind: 'decoy' };
  }
  if (item) {
    item.state = 'destroyed';
    b.known.add(item.id);
    setMark(b, cell, 'item_wreck');
    checkDecoyExposure(b);
    return { cell, outcome: 'item_destroyed', itemKind: item.kind };
  }

  setMark(b, cell, 'miss');
  checkDecoyExposure(b);
  return { cell, outcome: 'miss' };
}

// ---------------------------------------------------------------- arsenal ---

export type Weapon =
  | 'torpedo'
  | 'double_torpedo'
  | 'bomber'
  | 'atomic'
  | 'submarine'
  | 'radar'
  | 'minesweeper';

export const AIRCRAFT: Weapon[] = ['torpedo', 'double_torpedo', 'bomber', 'atomic'];

export const FUEL: Record<Weapon | 'aa_gun' | 'mine' | 'sonar_net' | 'decoy', number> = {
  torpedo: 20,
  double_torpedo: 35,
  bomber: 30,
  atomic: 60,
  submarine: 10,
  radar: 15,
  minesweeper: 15,
  aa_gun: 10,
  mine: 5,
  sonar_net: 10,
  decoy: 5,
};

export const CAP: Record<string, number> = {
  torpedo: 2,
  double_torpedo: 2,
  bomber: 2,
  atomic: 1,
  submarine: 1,
  radar: 1,
  minesweeper: 1,
  aa_gun: 3,
  mine: 5,
  sonar_net: 2,
  decoy: 3,
};

export type Attack = {
  weapon: Weapon;
  intercepted?: 'aa_gun' | 'sonar_net';
  resolutions: Resolution[];
  radarCount?: number;
  disarmed?: Cell[];
  hitSomething: boolean;
  mineTriggered: boolean;
  keepsTurn: boolean;
};

/** Doc §8.1 - which rows an aircraft crosses. */
export function rowsCrossed(weapon: Weapon, target: Cell): number[] {
  switch (weapon) {
    case 'torpedo':
      return [target.r];
    case 'double_torpedo': {
      const top = Math.min(target.r, SIZE - 2);
      return [top, top + 1];
    }
    case 'bomber':
      return [target.r, target.r + 1].filter((r) => r < SIZE);
    case 'atomic':
      return [target.r - 1, target.r, target.r + 1].filter((r) => r >= 0 && r < SIZE);
    default:
      return [];
  }
}

function torpedoRun(b: Board, row: number): Resolution[] {
  for (let c = 0; c < SIZE; c++) {
    const cell = { r: row, c };
    const ship = shipAt(b, cell);
    if (ship) {
      const i = ship.cells.findIndex((x) => x.r === row && x.c === c);
      if (!ship.hit[i]) return [resolveCell(b, cell, { inFootprint: true })];
      continue; // passes over wrecks and earlier hits
    }
    const item = liveItemAt(b, cell);
    if (item && item.kind === 'decoy') return [resolveCell(b, cell, { inFootprint: true })];
    // mines, guns, nets, radar and misses are all passed over
  }
  return [];
}

function columnRun(b: Board, col: number, from: number, step: -1 | 1): Resolution[] {
  for (let r = from; r >= 0 && r < SIZE; r += step) {
    const cell = { r, c: col };
    const ship = shipAt(b, cell);
    if (ship) {
      const i = ship.cells.findIndex((x) => x.r === r && x.c === col);
      if (!ship.hit[i]) return [resolveCell(b, cell, { inFootprint: true })];
      continue;
    }
    const item = liveItemAt(b, cell);
    if (item && item.kind === 'decoy') return [resolveCell(b, cell, { inFootprint: true })];
  }
  return [];
}

const atomicOrder = (t: Cell): Cell[] =>
  [
    { r: t.r, c: t.c },
    { r: t.r - 1, c: t.c },
    { r: t.r - 1, c: t.c + 1 },
    { r: t.r, c: t.c + 1 },
    { r: t.r + 1, c: t.c + 1 },
    { r: t.r + 1, c: t.c },
    { r: t.r + 1, c: t.c - 1 },
    { r: t.r, c: t.c - 1 },
    { r: t.r - 1, c: t.c - 1 },
  ].filter(inGrid);

/** Fire one arsenal item at the enemy board. */
export function useWeapon(b: Board, weapon: Weapon, target: Cell): Attack {
  const out: Attack = {
    weapon,
    resolutions: [],
    hitSomething: false,
    mineTriggered: false,
    keepsTurn: false,
  };

  // Interception happens before anything resolves (doc §8.2).
  if (AIRCRAFT.includes(weapon)) {
    const rows = rowsCrossed(weapon, target);
    const gun = b.layout.items.find(
      (i) => i.kind === 'aa_gun' && i.state === 'live' && rows.includes(i.cell.r),
    );
    if (gun) {
      b.known.add(gun.id);
      return { ...out, intercepted: 'aa_gun' };
    }
  }
  if (weapon === 'submarine') {
    const net = b.layout.items.find(
      (i) => i.kind === 'sonar_net' && i.state === 'live' && i.cell.c === target.c,
    );
    if (net) {
      b.known.add(net.id);
      return { ...out, intercepted: 'sonar_net' };
    }
  }

  switch (weapon) {
    case 'torpedo':
      out.resolutions = torpedoRun(b, target.r);
      break;
    case 'double_torpedo': {
      const [a, z] = rowsCrossed('double_torpedo', target);
      out.resolutions = [...torpedoRun(b, a), ...torpedoRun(b, z)];
      break;
    }
    case 'bomber':
      out.resolutions = [
        { r: target.r, c: target.c },
        { r: target.r, c: target.c + 1 },
        { r: target.r + 1, c: target.c },
      ]
        .filter(inGrid)
        .map((c) => resolveCell(b, c, { inFootprint: true }));
      break;
    case 'atomic':
      out.resolutions = atomicOrder(target).map((c) => resolveCell(b, c, { inFootprint: true }));
      break;
    case 'submarine':
      out.resolutions = [
        ...columnRun(b, target.c, target.r - 1, -1),
        ...columnRun(b, target.c, target.r + 1, 1),
      ];
      break;
    case 'radar': {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = { r: target.r + dr, c: target.c + dc };
          if (!inGrid(c)) continue;
          if (shipAt(b, c)) n++;
        }
      out.radarCount = n;
      const radar = b.layout.items.find((i) => i.kind === 'radar');
      if (radar && radar.state === 'live') radar.state = 'used';
      break;
    }
    case 'minesweeper': {
      const top = Math.min(target.r, SIZE - 2);
      const disarmed: Cell[] = [];
      for (const row of [top, top + 1])
        for (const item of b.layout.items)
          if (item.kind === 'mine' && item.state === 'live' && item.cell.r === row) {
            item.state = 'neutralised';
            b.marks[item.cell.r][item.cell.c] = 'mine_disarmed';
            b.known.add(item.id);
            disarmed.push(item.cell);
          }
      out.disarmed = disarmed;
      break;
    }
  }

  out.hitSomething = out.resolutions.some(
    (r) => r.outcome === 'hit' || r.outcome === 'sunk' || r.outcome === 'decoy_hit' || r.outcome === 'item_destroyed',
  );
  out.mineTriggered = out.resolutions.some((r) => r.outcome === 'mine');
  // Doc §7.3: a hit keeps the turn, a mine always ends it. Radar ends the turn.
  // The minesweeper is the one free action in the game (Part 5).
  out.keepsTurn =
    weapon === 'minesweeper' ? true : out.hitSomething && !out.mineTriggered && weapon !== 'radar';
  checkDecoyExposure(b);
  return out;
}

/** Match semantics for a plain shot. */
export const shotKeepsTurn = (r: Resolution) =>
  r.outcome === 'hit' ||
  r.outcome === 'sunk' ||
  r.outcome === 'decoy_hit' ||
  r.outcome === 'item_destroyed';

export const markGridKey = (b: Board) =>
  b.marks.map((row) => row.map((m) => m[0]).join('')).join('|');

export const unknownCells = (b: Board): Cell[] => {
  const out: Cell[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (!isMarked(b.marks[r][c])) out.push({ r, c });
  return out;
};

export const keyOf = key;
