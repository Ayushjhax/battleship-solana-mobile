/**
 * The 5x5 skirmish — part-09 §5.6 and §5.7.
 *
 *   5.7 "Skirmish rules on the 5 x 5 board: no-touch placement is still
 *        satisfiable (**there is a test that generates 10,000 legal boards**),
 *        turns, win/lose."
 *   5.6 "**a pirate skirmish log that does not replay is rejected and pays
 *        half**."
 *
 * The 10,000-board sweep is not ceremony. Seven ship cells plus their halos on
 * twenty-five squares is tight, and it is genuinely not obvious the constraint
 * is reliably satisfiable — if the generator failed one board in fifty, one
 * player in fifty would get a voyage they could not fight.
 */
import { describe, expect, it } from 'vitest';

import { createRng } from '@engine/rng';
import {
  LOSS_SHARE,
  SKIRMISH_CELLS,
  SKIRMISH_FLEET,
  SKIRMISH_SIZE,
  TURN_MS,
  WIN_BONUS,
  cellsOf,
  haloOf,
  isLegalLayout,
  key,
  payout,
  pirateMove,
  placeSkirmish,
  replaySkirmish,
  shoot,
  startSkirmish,
  type Cell,
  type SkirmishLog,
  type SkirmishState,
} from '@engine/voyages';

// ===========================================================================
// §5.7 — THE 10,000-BOARD LEGALITY SWEEP
// ===========================================================================

describe('no-touch placement on 5x5 is satisfiable', () => {
  it('generates 10,000 legal boards', () => {
    let generated = 0;
    let failed = 0;

    for (let seed = 1; seed <= 10_000; seed++) {
      const ships = placeSkirmish(createRng(seed));
      if (!ships) {
        failed++;
        continue;
      }
      generated++;

      // Every ship on the board, the right lengths, and nothing touching.
      expect(isLegalLayout(ships), `seed ${seed}`).toBe(true);
    }

    expect(failed, `${failed} of 10,000 boards could not be placed`).toBe(0);
    expect(generated).toBe(10_000);
  });

  it('...and the legality check is doing real work, not returning true', () => {
    // Two ships touching: the 3-cell at (0,0) horizontal and a skiff at (1,0),
    // which is diagonally adjacent and so illegal under no-touch.
    const touching = [
      { id: 'cutter', len: 3, r: 0, c: 0, horizontal: true },
      { id: 'launch', len: 2, r: 2, c: 0, horizontal: true },
      { id: 'skiff-1', len: 1, r: 1, c: 0, horizontal: true },
      { id: 'skiff-2', len: 1, r: 4, c: 4, horizontal: true },
    ];
    expect(isLegalLayout(touching)).toBe(false);
  });

  it('rejects a board with a ship off the edge', () => {
    const off = [
      { id: 'cutter', len: 3, r: 0, c: 3, horizontal: true }, // runs to c=5
      { id: 'launch', len: 2, r: 2, c: 0, horizontal: true },
      { id: 'skiff-1', len: 1, r: 4, c: 0, horizontal: true },
      { id: 'skiff-2', len: 1, r: 4, c: 4, horizontal: true },
    ];
    expect(isLegalLayout(off)).toBe(false);
  });

  it('rejects a board missing a ship, or with a wrong length', () => {
    const ships = placeSkirmish(createRng(1))!;
    expect(isLegalLayout(ships.slice(0, 3))).toBe(false);
    expect(isLegalLayout(ships.map((s, n) => (n === 0 ? { ...s, len: 4 } : s)))).toBe(false);
  });

  it('is §3’s fleet: one 3, one 2, two 1s on a 5x5', () => {
    expect(SKIRMISH_SIZE).toBe(5);
    expect(SKIRMISH_FLEET.map((s) => s.len).sort()).toEqual([1, 1, 2, 3]);
    expect(SKIRMISH_CELLS).toBe(7);
  });

  it('the same seed gives the same board', () => {
    expect(placeSkirmish(createRng(42))).toEqual(placeSkirmish(createRng(42)));
  });

  it('halo covers the diagonals — that is what makes it tight', () => {
    const ship = { id: 'skiff-1', len: 1, r: 2, c: 2, horizontal: true };
    const halo = haloOf(ship).map(key).sort();
    expect(halo).toContain('1,1'); // diagonal
    expect(halo).toContain('3,3');
    expect(halo).toHaveLength(8);
  });

  it('a ship at a corner has a smaller halo, and that is fine', () => {
    expect(haloOf({ id: 'skiff-1', len: 1, r: 0, c: 0, horizontal: true })).toHaveLength(3);
  });
});

// ===========================================================================
// §5.7 — turns, win and lose
// ===========================================================================

describe('the skirmish rules', () => {
  const fresh = () => startSkirmish(7)!;

  it('starts with the player, as §3 says', () => {
    expect(fresh().turn).toBe('player');
    expect(TURN_MS).toBe(10_000);
  });

  it('a miss passes the turn; a hit keeps it', () => {
    const state = fresh();
    const pirateCells = new Set(state.pirateShips.flatMap((s) => cellsOf(s).map(key)));

    let missAt: Cell | null = null;
    let hitAt: Cell | null = null;
    for (let r = 0; r < 5 && (!missAt || !hitAt); r++) {
      for (let c = 0; c < 5; c++) {
        const cell = { r, c };
        if (pirateCells.has(key(cell))) hitAt ??= cell;
        else missAt ??= cell;
      }
    }

    expect(shoot(state, { side: 'player', at: hitAt! }).state.turn).toBe('player');
    expect(shoot(state, { side: 'player', at: missAt! }).state.turn).toBe('pirate');
  });

  it('rejects a shot out of turn, off the board, or on a resolved cell', () => {
    const state = fresh();
    expect(shoot(state, { side: 'pirate', at: { r: 0, c: 0 } }).rejected).toBe(true);
    expect(shoot(state, { side: 'player', at: { r: 9, c: 9 } }).rejected).toBe(true);

    const after = shoot(state, { side: 'player', at: { r: 0, c: 0 } }).state;
    expect(shoot(after, { side: 'player', at: { r: 0, c: 0 } }).rejected).toBe(true);
  });

  it('a sunk ship marks its hull and clears its halo, as the 10x10 does', () => {
    let state = fresh();
    const skiff = state.pirateShips.find((s) => s.len === 1)!;
    state = shoot(state, { side: 'player', at: { r: skiff.r, c: skiff.c } }).state;

    expect(state.playerMarks[key({ r: skiff.r, c: skiff.c })]).toBe('sunk');
    for (const cell of haloOf(skiff)) {
      expect(state.playerMarks[key(cell)], key(cell)).toBe('miss');
    }
  });

  it('the player wins by sinking all four', () => {
    let state: SkirmishState = fresh();
    for (const ship of state.pirateShips) {
      for (const cell of cellsOf(ship)) {
        if (state.over) break;
        if (state.playerMarks[key(cell)] === 'sunk') continue;
        state = shoot(state, { side: 'player', at: cell }).state;
      }
    }
    expect(state.over).toBe(true);
    expect(state.winner).toBe('player');
  });

  it('a finished skirmish takes no more shots', () => {
    let state: SkirmishState = fresh();
    for (const ship of state.pirateShips) {
      for (const cell of cellsOf(ship)) {
        if (!state.over && state.playerMarks[key(cell)] !== 'sunk') {
          state = shoot(state, { side: 'player', at: cell }).state;
        }
      }
    }
    expect(shoot(state, { side: 'player', at: { r: 0, c: 0 } }).rejected).toBe(true);
  });
});

describe('the pirate', () => {
  it('is deterministic — the security model depends on it', () => {
    const marks = { '0,0': 'miss' as const };
    expect(pirateMove(marks, createRng(5))).toEqual(pirateMove(marks, createRng(5)));
  });

  it('targets around a hit rather than hunting', () => {
    const marks = { '2,2': 'hit' as const };
    const move = pirateMove(marks, createRng(1))!;
    const adjacent = [
      { r: 1, c: 2 },
      { r: 3, c: 2 },
      { r: 2, c: 1 },
      { r: 2, c: 3 },
    ];
    expect(adjacent.some((cell) => cell.r === move.r && cell.c === move.c)).toBe(true);
  });

  it('never picks a resolved cell', () => {
    const marks: Record<string, 'miss'> = {};
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) marks[`${r},${c}`] = 'miss';
    for (let seed = 0; seed < 50; seed++) {
      const move = pirateMove(marks, createRng(seed))!;
      expect(move.c).toBe(4);
    }
  });

  it('returns null on a full board rather than looping', () => {
    const marks: Record<string, 'miss'> = {};
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) marks[`${r},${c}`] = 'miss';
    expect(pirateMove(marks, createRng(1))).toBeNull();
  });
});

// ===========================================================================
// §5.6 — THE REPLAY
// ===========================================================================

/**
 * Plays a real skirmish and returns the log an honest client would submit.
 *
 * Deliberately NOT perfect play: a player who only ever hits keeps the turn and
 * wins in seven shots, and the pirate never fires — which would leave the half
 * of the replay that matters (the recomputed pirate sequence) untested. A
 * row-major scan misses often, so the turn passes back and forth the way a real
 * game does.
 */
function honestLog(seed: number): SkirmishLog {
  let state = startSkirmish(seed)!;
  const pirateRng = createRng(seed ^ 0x5bf0_3a9d);
  const shots: Cell[] = [];

  outer: for (let r = 0; r < SKIRMISH_SIZE; r++) {
    for (let c = 0; c < SKIRMISH_SIZE; c++) {
      if (state.over) break outer;
      const at = { r, c };
      if (state.playerMarks[key(at)] !== undefined) continue;

      shots.push(at);
      state = shoot(state, { side: 'player', at }).state;

      while (!state.over && state.turn === 'pirate') {
        const move = pirateMove(state.pirateMarks, pirateRng);
        if (!move) break;
        state = shoot(state, { side: 'pirate', at: move }).state;
      }
    }
  }
  return { seed, shots, claimedWinner: state.winner ?? 'pirate' };
}

describe('the server replay', () => {
  it('ACCEPTS an honest log', () => {
    for (const seed of [1, 2, 3, 11, 99]) {
      const verdict = replaySkirmish(honestLog(seed));
      expect(verdict.ok, `seed ${seed}`).toBe(true);
    }
  });

  it('...and reproduces the same winner', () => {
    const log = honestLog(3);
    const verdict = replaySkirmish(log);
    expect(verdict.ok && verdict.winner).toBe(log.claimedWinner);
  });

  it('REJECTS a log claiming a win it did not earn', () => {
    const log = honestLog(3);
    const forged: SkirmishLog = { ...log, shots: log.shots.slice(0, 2), claimedWinner: 'player' };
    const verdict = replaySkirmish(forged);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('unfinished');
  });

  it('REJECTS a log with an illegal shot', () => {
    const log = honestLog(3);
    const forged: SkirmishLog = { ...log, shots: [{ r: 9, c: 9 }, ...log.shots] };
    const verdict = replaySkirmish(forged);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('illegal-shot');
  });

  it('REJECTS a log that repeats a cell', () => {
    const log = honestLog(3);
    const first = log.shots[0]!;
    const forged: SkirmishLog = { ...log, shots: [first, first, ...log.shots.slice(1)] };
    expect(replaySkirmish(forged).ok).toBe(false);
  });

  it('REJECTS a log replayed against the WRONG seed', () => {
    // The layout is the server's. A log from another board does not fit it.
    const log = honestLog(3);
    const verdict = replaySkirmish({ ...log, seed: 4 });
    expect(verdict.ok).toBe(false);
  });

  it('REJECTS a log claiming the wrong winner on a finished game', () => {
    // Both directions: seed 3 is a player win, seed 11 a pirate win. Flipping
    // either claim must be caught, so this is not a one-sided check.
    for (const seed of [3, 11]) {
      const log = honestLog(seed);
      const flipped = log.claimedWinner === 'player' ? 'pirate' : 'player';
      const verdict = replaySkirmish({ ...log, claimedWinner: flipped });
      expect(verdict.ok, `seed ${seed}`).toBe(false);
      expect(verdict.ok === false && verdict.reason).toBe('wrong-winner');
    }
  });

  it('the fixture really does hand the pirate turns', () => {
    // If this ever goes quiet, the honest-log fixture has regressed into
    // perfect play and the replay's recomputed pirate sequence — the half that
    // actually secures the voyage — is no longer under test.
    const log = honestLog(3);
    let state = startSkirmish(3)!;
    let pirateShots = 0;
    const rng = createRng(3 ^ 0x5bf0_3a9d);
    for (const at of log.shots) {
      if (state.over) break;
      state = shoot(state, { side: 'player', at }).state;
      while (!state.over && state.turn === 'pirate') {
        const move = pirateMove(state.pirateMarks, rng);
        if (!move) break;
        state = shoot(state, { side: 'pirate', at: move }).state;
        pirateShots++;
      }
    }
    expect(pirateShots).toBeGreaterThan(0);
  });

  it('is deterministic — the same log verifies the same way twice', () => {
    const log = honestLog(11);
    expect(replaySkirmish(log)).toEqual(replaySkirmish(log));
  });
});

// ===========================================================================
// §5.6 — "a log that does not replay ... pays half"
// ===========================================================================

describe('what a skirmish pays', () => {
  const cargo = { coins: 400, steel: 0, gems: 10, cosmetic: null, pirate: true };

  it('a WIN pays full plus 25%', () => {
    expect(WIN_BONUS).toBe(0.25);
    expect(payout(cargo, 'won')).toMatchObject({ coins: 500, gems: 12 });
  });

  it('a LOSS pays half', () => {
    expect(LOSS_SHARE).toBe(0.5);
    expect(payout(cargo, 'lost')).toMatchObject({ coins: 200, gems: 5 });
  });

  it('IGNORING it for 24 h pays half', () => {
    expect(payout(cargo, 'ignored').coins).toBe(200);
  });

  it('AN UNVERIFIED LOG pays half — not zero, and not full', () => {
    // A log that does not replay is indistinguishable from not having played.
    // Half removes the incentive to forge without punishing a player whose
    // phone died mid-skirmish.
    expect(payout(cargo, 'unverified')).toEqual(payout(cargo, 'lost'));
  });

  it('a voyage with no pirates pays exactly its cargo', () => {
    expect(payout(cargo, 'none')).toMatchObject({ coins: 400, gems: 10 });
  });

  it('never pays a fraction', () => {
    for (const result of ['won', 'lost', 'ignored', 'unverified', 'none'] as const) {
      const paid = payout({ coins: 333, steel: 777, gems: 3, cosmetic: null, pirate: true }, result);
      expect(Number.isInteger(paid.coins)).toBe(true);
      expect(Number.isInteger(paid.steel)).toBe(true);
      expect(Number.isInteger(paid.gems)).toBe(true);
    }
  });
});
