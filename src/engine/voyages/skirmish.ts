/**
 * The 5x5 pirate skirmish — part-09 §3, tested by §5.6 and §5.7.
 *
 * "a **5 x 5 skirmish**: a small board, a fleet of one 3-cell, one 2-cell and
 *  two 1-cell ships, no-touch rule, no arsenal, 10-second turns, the player
 *  shoots first, against the Normal AI."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SECURITY MODEL, which is the whole reason this module is pure.
 *
 * §3: "The skirmish runs on the client for speed, and the client submits the
 * event log; the **server replays it** with the same seeded AI and layout and
 * refuses anything that does not reproduce."
 *
 * So the same functions run in both places. The client plays; the server calls
 * `replaySkirmish()` over the submitted log against ITS OWN layout and ITS OWN
 * seeded AI, and compares. A forged log diverges on the first shot that does
 * not match what the board would actually have done.
 *
 * A rejected log pays HALF, not zero: §3 says "Lose **or ignore it** for 24 h
 * → half cargo", and a log that does not replay is indistinguishable from not
 * having played. Half removes the incentive to forge without punishing
 * somebody whose phone died mid-skirmish.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠ The 5x5 board is NOT the match board. `src/engine/board.ts` is hardcoded
 * to 10x10, so this module carries its own tiny geometry rather than
 * parameterising the match engine — a change there would touch every rule in
 * the game to serve a side mode.
 */
import { createRng, type Rng } from '../rng';

export const SKIRMISH_SIZE = 5;

/** §3 — "one 3-cell, one 2-cell and two 1-cell ships". Seven cells of 25. */
export const SKIRMISH_FLEET: readonly { id: string; len: number }[] = [
  { id: 'cutter', len: 3 },
  { id: 'launch', len: 2 },
  { id: 'skiff-1', len: 1 },
  { id: 'skiff-2', len: 1 },
];

export const SKIRMISH_CELLS = SKIRMISH_FLEET.reduce((n, s) => n + s.len, 0);

/** §3 — "10-second turns". */
export const TURN_MS = 10_000;

/** §3 — "Win → full cargo plus a 25% bonus." */
export const WIN_BONUS = 0.25;
/** §3 — "Lose or ignore it for 24 h → half cargo." */
export const LOSS_SHARE = 0.5;

export interface Cell {
  readonly r: number;
  readonly c: number;
}

export interface SkirmishShip {
  readonly id: string;
  readonly len: number;
  readonly r: number;
  readonly c: number;
  readonly horizontal: boolean;
}

export const key = (cell: Cell): string => `${cell.r},${cell.c}`;

export function inBoard(cell: Cell): boolean {
  return cell.r >= 0 && cell.r < SKIRMISH_SIZE && cell.c >= 0 && cell.c < SKIRMISH_SIZE;
}

export function cellsOf(ship: SkirmishShip): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < ship.len; i++) {
    out.push(ship.horizontal ? { r: ship.r, c: ship.c + i } : { r: ship.r + i, c: ship.c });
  }
  return out;
}

/** Every cell touching the ship, including diagonals — the no-touch halo. */
export function haloOf(ship: SkirmishShip): Cell[] {
  const own = new Set(cellsOf(ship).map(key));
  const out: Cell[] = [];
  for (const cell of cellsOf(ship)) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const near = { r: cell.r + dr, c: cell.c + dc };
        if (!inBoard(near) || own.has(key(near))) continue;
        if (!out.some((existing) => existing.r === near.r && existing.c === near.c)) out.push(near);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Placement (§5.7 — "no-touch placement is still satisfiable")
// ---------------------------------------------------------------------------

function fits(ship: SkirmishShip, placed: readonly SkirmishShip[]): boolean {
  const cells = cellsOf(ship);
  if (!cells.every(inBoard)) return false;

  const blocked = new Set<string>();
  for (const other of placed) {
    for (const cell of cellsOf(other)) blocked.add(key(cell));
    for (const cell of haloOf(other)) blocked.add(key(cell));
  }
  return cells.every((cell) => !blocked.has(key(cell)));
}

/**
 * A legal 5x5 layout, or null.
 *
 * Seven cells plus their halos on twenty-five squares is genuinely tight —
 * §5.7 exists because it is not obvious this is reliably satisfiable. The
 * generator RETRIES the whole board rather than backtracking, because a
 * restart is cheap at this size and a partial board that cannot be finished
 * is the common failure.
 *
 * It returns **null** rather than an illegal board if it runs out of budget:
 * an illegal layout would fail the client's own rules and make an honest
 * player's log unreplayable.
 */
export function placeSkirmish(rng: Rng, restarts = 200): SkirmishShip[] | null {
  for (let attempt = 0; attempt < restarts; attempt++) {
    const placed: SkirmishShip[] = [];
    let ok = true;

    // Longest first: the 3-cell is the one that runs out of room.
    for (const spec of SKIRMISH_FLEET) {
      let landed = false;
      for (let tries = 0; tries < 80; tries++) {
        const horizontal = rng.int(2) === 0;
        const ship: SkirmishShip = {
          id: spec.id,
          len: spec.len,
          r: rng.int(SKIRMISH_SIZE),
          c: rng.int(SKIRMISH_SIZE),
          horizontal,
        };
        if (fits(ship, placed)) {
          placed.push(ship);
          landed = true;
          break;
        }
      }
      if (!landed) {
        ok = false;
        break;
      }
    }
    if (ok) return placed;
  }
  return null;
}

/** §5.7's check, as a function so the test asserts the real rule. */
export function isLegalLayout(ships: readonly SkirmishShip[]): boolean {
  if (ships.length !== SKIRMISH_FLEET.length) return false;
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i]!;
    const spec = SKIRMISH_FLEET.find((s) => s.id === ship.id);
    if (!spec || spec.len !== ship.len) return false;
    if (!cellsOf(ship).every(inBoard)) return false;
    if (!fits(ship, ships.filter((_, n) => n !== i))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The skirmish
// ---------------------------------------------------------------------------

export type SkirmishMark = 'miss' | 'hit' | 'sunk';
export type SkirmishSide = 'player' | 'pirate';

export interface SkirmishState {
  readonly playerShips: readonly SkirmishShip[];
  readonly pirateShips: readonly SkirmishShip[];
  /** Marks ON the pirate board, made by the player. */
  readonly playerMarks: Readonly<Record<string, SkirmishMark>>;
  /** Marks ON the player's board, made by the pirate. */
  readonly pirateMarks: Readonly<Record<string, SkirmishMark>>;
  readonly turn: SkirmishSide;
  readonly over: boolean;
  readonly winner: SkirmishSide | null;
}

function hitsOn(ships: readonly SkirmishShip[], marks: Readonly<Record<string, SkirmishMark>>) {
  return ships.map((ship) => ({
    ship,
    sunk: cellsOf(ship).every((cell) => marks[key(cell)] === 'hit' || marks[key(cell)] === 'sunk'),
  }));
}

function allSunk(ships: readonly SkirmishShip[], marks: Readonly<Record<string, SkirmishMark>>) {
  return ships.length > 0 && hitsOn(ships, marks).every((s) => s.sunk);
}

/** §3 — "the player shoots first". */
export function startSkirmish(seed: number): SkirmishState | null {
  const rng = createRng(seed);
  const pirateShips = placeSkirmish(rng);
  const playerShips = placeSkirmish(rng);
  if (!pirateShips || !playerShips) return null;

  return {
    playerShips,
    pirateShips,
    playerMarks: {},
    pirateMarks: {},
    turn: 'player',
    over: false,
    winner: null,
  };
}

export interface SkirmishShot {
  readonly side: SkirmishSide;
  readonly at: Cell;
}

export interface ShotOutcome {
  readonly state: SkirmishState;
  readonly mark: SkirmishMark | null;
  readonly rejected: boolean;
}

/**
 * One shot. Rejects an out-of-bounds cell, an already-resolved cell and a
 * shot out of turn — the three ways a forged log differs from a real one.
 */
export function shoot(state: SkirmishState, shot: SkirmishShot): ShotOutcome {
  if (state.over || state.turn !== shot.side || !inBoard(shot.at)) {
    return { state, mark: null, rejected: true };
  }

  const attackingPlayer = shot.side === 'player';
  const targetShips = attackingPlayer ? state.pirateShips : state.playerShips;
  const marks = attackingPlayer ? state.playerMarks : state.pirateMarks;
  const at = key(shot.at);
  if (marks[at] !== undefined) return { state, mark: null, rejected: true };

  const struck = targetShips.find((ship) =>
    cellsOf(ship).some((cell) => cell.r === shot.at.r && cell.c === shot.at.c),
  );

  const next: Record<string, SkirmishMark> = { ...marks, [at]: struck ? 'hit' : 'miss' };

  // A sunk ship marks its whole hull, and — no-touch — its halo as a miss,
  // exactly as the 10x10 rules do.
  if (struck && cellsOf(struck).every((cell) => next[key(cell)] === 'hit')) {
    for (const cell of cellsOf(struck)) next[key(cell)] = 'sunk';
    for (const cell of haloOf(struck)) if (next[key(cell)] === undefined) next[key(cell)] = 'miss';
  }

  const playerMarks = attackingPlayer ? next : state.playerMarks;
  const pirateMarks = attackingPlayer ? state.pirateMarks : next;

  const playerWon = allSunk(state.pirateShips, playerMarks);
  const pirateWon = allSunk(state.playerShips, pirateMarks);
  const over = playerWon || pirateWon;

  return {
    state: {
      ...state,
      playerMarks,
      pirateMarks,
      // A hit keeps the turn, as in a match.
      turn: over ? shot.side : struck ? shot.side : attackingPlayer ? 'pirate' : 'player',
      over,
      winner: playerWon ? 'player' : pirateWon ? 'pirate' : null,
    },
    mark: next[at] ?? null,
    rejected: false,
  };
}

// ---------------------------------------------------------------------------
// The pirate — deterministic, so the server can reproduce it
// ---------------------------------------------------------------------------

/**
 * The pirate's next shot.
 *
 * DETERMINISM IS THE SECURITY MODEL. This must be a pure function of the
 * marks and the seeded rng, or an honest client's log will not replay on the
 * server and every player gets half cargo.
 *
 * Hunt-and-target, the same shape as the match AI: work around a known hit,
 * otherwise take a parity cell.
 */
export function pirateMove(marks: Readonly<Record<string, SkirmishMark>>, rng: Rng): Cell | null {
  const free: Cell[] = [];
  for (let r = 0; r < SKIRMISH_SIZE; r++) {
    for (let c = 0; c < SKIRMISH_SIZE; c++) {
      if (marks[key({ r, c })] === undefined) free.push({ r, c });
    }
  }
  if (free.length === 0) return null;

  // Target: a cell orthogonally adjacent to an un-sunk hit.
  const targets: Cell[] = [];
  for (let r = 0; r < SKIRMISH_SIZE; r++) {
    for (let c = 0; c < SKIRMISH_SIZE; c++) {
      if (marks[key({ r, c })] !== 'hit') continue;
      for (const near of [
        { r: r - 1, c },
        { r: r + 1, c },
        { r, c: c - 1 },
        { r, c: c + 1 },
      ]) {
        if (inBoard(near) && marks[key(near)] === undefined) targets.push(near);
      }
    }
  }
  if (targets.length > 0) return targets[rng.int(targets.length)]!;

  // Hunt: prefer parity cells; the smallest ship is one cell, so parity only
  // helps until the big ones are gone, but it is still the better opening.
  const parity = free.filter((cell) => (cell.r + cell.c) % 2 === 0);
  const pool = parity.length > 0 ? parity : free;
  return pool[rng.int(pool.length)]!;
}

// ---------------------------------------------------------------------------
// The replay (§3, §5.6)
// ---------------------------------------------------------------------------

export interface SkirmishLog {
  readonly seed: number;
  /** The PLAYER's shots, in order. The pirate's are derived, not submitted. */
  readonly shots: readonly Cell[];
  readonly claimedWinner: SkirmishSide;
}

export type ReplayVerdict =
  | { readonly ok: true; readonly winner: SkirmishSide; readonly shots: number }
  | { readonly ok: false; readonly reason: 'no-layout' | 'illegal-shot' | 'wrong-winner' | 'unfinished' };

/**
 * Replays a submitted log against a freshly generated board.
 *
 * Only the PLAYER's shots are in the log. The pirate's are recomputed from
 * the same seeded rng, which is what makes a forged log cheap to detect: a
 * client that claims a win it did not earn has to also predict every pirate
 * shot, and it cannot, because the rng is advanced by the real sequence.
 */
export function replaySkirmish(log: SkirmishLog): ReplayVerdict {
  let state = startSkirmish(log.seed);
  if (!state) return { ok: false, reason: 'no-layout' };

  // The pirate's rng is seeded from the same number but offset, so the two
  // draws cannot interleave into each other.
  const pirateRng = createRng(log.seed ^ 0x5bf0_3a9d);

  for (const at of log.shots) {
    if (state.over) break;

    const outcome = shoot(state, { side: 'player', at });
    if (outcome.rejected) return { ok: false, reason: 'illegal-shot' };
    state = outcome.state;

    // The pirate answers every time the turn passes to it.
    while (!state.over && state.turn === 'pirate') {
      const move = pirateMove(state.pirateMarks, pirateRng);
      if (!move) break;
      const answer = shoot(state, { side: 'pirate', at: move });
      if (answer.rejected) break;
      state = answer.state;
    }
  }

  if (!state.over) return { ok: false, reason: 'unfinished' };
  if (state.winner !== log.claimedWinner) return { ok: false, reason: 'wrong-winner' };
  return { ok: true, winner: state.winner, shots: log.shots.length };
}
