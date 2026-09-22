import { describe, expect, it } from 'vitest';
import { RAID, fireShell, kitLeft, raidScore, startRaid, useKit, end } from '../src/raid.js';
import { randomLayout } from '../src/random.js';
import { Layout } from '../src/grid.js';
import { cell, item, ship } from './helpers.js';

const layoutOf = (ships: any[], items: any[] = []): Layout => ({ ships, items });

describe('shells', () => {
  it('a miss costs one shell', () => {
    const s = startRaid(layoutOf([ship('boat', 0, 0)]));
    fireShell(s, cell(5, 5));
    expect(s.shells).toBe(RAID.shells - 1);
  });

  it('a hit hands the shell straight back', () => {
    const s = startRaid(layoutOf([ship('cruiser', 3, 3)]));
    fireShell(s, cell(3, 3));
    expect(s.shells).toBe(RAID.shells);
  });

  it('destroying a defence also hands the shell back', () => {
    const s = startRaid(layoutOf([ship('boat', 0, 0)], [item('aa_gun', 6, 6)]));
    fireShell(s, cell(6, 6));
    expect(s.shells).toBe(RAID.shells);
  });

  it('a mine costs the shell plus the penalty', () => {
    const s = startRaid(layoutOf([ship('boat', 0, 0)], [item('mine', 6, 6)]));
    fireShell(s, cell(6, 6));
    expect(s.shells).toBe(RAID.shells - 1 - RAID.minePenalty);
  });

  it('a decoy refunds the shell and then eats the shells spent around it', () => {
    const s = startRaid(layoutOf([ship('boat', 0, 0)], [item('decoy', 5, 5)]));
    fireShell(s, cell(5, 5));
    expect(s.shells).toBe(RAID.shells);
    for (const c of [cell(4, 5), cell(6, 5), cell(5, 4), cell(5, 6)]) fireShell(s, c);
    expect(s.shells).toBe(RAID.shells - 4);
    expect(s.board.marks[5][5]).toBe('hit'); // still lying: eight neighbours are needed
  });

  it('refuses a cell that was already resolved', () => {
    const s = startRaid(layoutOf([ship('boat', 0, 0)]));
    fireShell(s, cell(5, 5));
    const again = fireShell(s, cell(5, 5));
    expect(again.error).toBe('illegal-cell');
    expect(s.shells).toBe(RAID.shells - 1);
  });

  it('kit items cost no shells but a mine in the footprint still bites', () => {
    const s = startRaid(layoutOf([ship('destroyer', 4, 3)], [item('mine', 4, 5)]), { atomic: 1 });
    const { attack } = useKit(s, 'atomic', cell(4, 4));
    expect(attack!.mineTriggered).toBe(true);
    expect(s.shells).toBe(RAID.shells - RAID.minePenalty);
    expect(kitLeft(s)).toBe(0);
  });

  it('an intercepted plane is still spent', () => {
    const s = startRaid(layoutOf([ship('boat', 3, 3)], [item('aa_gun', 3, 9)]), { torpedo: 1 });
    const { attack } = useKit(s, 'torpedo', cell(3, 0));
    expect(attack!.intercepted).toBe('aa_gun');
    expect(kitLeft(s)).toBe(0);
    expect(s.shells).toBe(RAID.shells);
  });
});

describe('stars and destruction', () => {
  const full = () => randomLayout(11);

  it('no stars for an empty raid', () => {
    const s = startRaid(full());
    expect(raidScore(s).stars).toBe(0);
  });

  it('sinking the battleship alone is one star', () => {
    const l = full();
    const s = startRaid(l);
    const bs = l.ships.find((x) => x.cls === 'battleship')!;
    for (const c of bs.cells) fireShell(s, c);
    const score = raidScore(s);
    expect(score.battleshipSunk).toBe(true);
    expect(score.stars).toBe(1);
    expect(score.destruction).toBeCloseTo(0.2);
  });

  it('half the tonnage without the battleship is also one star', () => {
    const l = full();
    const s = startRaid(l, {}, 0, { ...RAID, shells: 999 });
    let cells = 0;
    for (const ship of l.ships) {
      if (ship.cls === 'battleship') continue;
      for (const c of ship.cells) {
        if (cells >= 10) break;
        fireShell(s, c);
        cells++;
      }
    }
    const score = raidScore(s);
    expect(score.destruction).toBeGreaterThanOrEqual(0.5);
    expect(score.battleshipSunk).toBe(false);
    expect(score.stars).toBe(1);
  });

  it('clearing the harbour is three stars and ends the raid', () => {
    const l = full();
    const s = startRaid(l, {}, 0, { ...RAID, shells: 999 });
    for (const ship of l.ships) for (const c of ship.cells) fireShell(s, c);
    expect(raidScore(s).stars).toBe(3);
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('cleared');
    expect(fireShell(s, cell(0, 0)).error).toBe('raid-over');
  });
});

describe('ending a raid', () => {
  it('runs out when the shells are gone and no kit is left', () => {
    const l = randomLayout(3);
    const s = startRaid(l, {}, 0, { ...RAID, shells: 3 });
    let fired = 0;
    for (let r = 0; r < 10 && !s.over; r++)
      for (let c = 0; c < 10 && !s.over; c++) {
        const res = fireShell(s, { r, c });
        if (!res.error) fired++;
      }
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('out_of_shells');
  });

  it('keeps going on zero shells while a kit item is left', () => {
    const s = startRaid(randomLayout(4), { bomber: 1 }, 0, { ...RAID, shells: 1 });
    fireShell(s, cell(0, 9)); // likely a miss; force the state either way
    s.shells = 0;
    expect(s.over).toBe(false);
    useKit(s, 'bomber', cell(5, 5));
    expect(s.over).toBe(true);
  });

  it('stops at the time limit', () => {
    const s = startRaid(randomLayout(5), {}, 1_000);
    fireShell(s, cell(0, 0), 1_000 + RAID.timeLimitMs);
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('time');
  });

  it('retreat is final', () => {
    const s = startRaid(randomLayout(6));
    end(s, 'retreat');
    expect(fireShell(s, cell(0, 0)).error).toBe('raid-over');
  });

  it('logs every action for the replay', () => {
    const s = startRaid(randomLayout(8), { radar: 1 });
    fireShell(s, cell(0, 0));
    useKit(s, 'radar', cell(5, 5));
    expect(s.log.map((e) => e.kind)).toEqual(['shot', 'weapon']);
  });
});
