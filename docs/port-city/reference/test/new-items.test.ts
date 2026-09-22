import { describe, expect, it } from 'vitest';
import { resolveCell, useWeapon } from '../src/resolve.js';
import { validateLayout } from '../src/grid.js';
import { randomLayout } from '../src/random.js';
import { board, cell, item, ship } from './helpers.js';

describe('Sonar Net - the submarine counter (mirrors the AA gun)', () => {
  it('eats a submarine that surfaces in its column', () => {
    const net = item('sonar_net', 9, 6);
    const b = board([ship('boat', 2, 6)], [net]);
    const a = useWeapon(b, 'submarine', cell(4, 6));
    expect(a.intercepted).toBe('sonar_net');
    expect(a.resolutions).toHaveLength(0);
    expect(b.known.has(net.id)).toBe(true); // the net shows on the attacker's board
    expect(b.marks[2][6]).toBe('unknown');
  });

  it('does nothing to aircraft', () => {
    const b = board([ship('boat', 3, 6)], [item('sonar_net', 3, 6 - 1)]);
    expect(useWeapon(b, 'torpedo', cell(3, 0)).intercepted).toBeUndefined();
  });

  it('guards only its own column', () => {
    const b = board([ship('boat', 2, 6)], [item('sonar_net', 9, 5)]);
    expect(useWeapon(b, 'submarine', cell(4, 6)).intercepted).toBeUndefined();
  });

  it('is destroyed by a plain shot and stops guarding, and the attacker keeps the turn', () => {
    const b = board([ship('boat', 2, 6)], [item('sonar_net', 9, 6)]);
    const r = resolveCell(b, cell(9, 6));
    expect(r.outcome).toBe('item_destroyed');
    expect(useWeapon(b, 'submarine', cell(4, 6)).intercepted).toBeUndefined();
  });

  it('is passed over by torpedoes like every other item', () => {
    const b = board([ship('boat', 3, 8)], [item('sonar_net', 3, 2)]);
    const a = useWeapon(b, 'torpedo', cell(3, 0));
    expect(a.resolutions[0].cell).toEqual({ r: 3, c: 8 });
    expect(b.layout.items[0].state).toBe('live');
  });
});

describe('Decoy Buoy - it lies', () => {
  it('reads as an ordinary hit and hands the shell/turn back', () => {
    const b = board([ship('boat', 0, 0)], [item('decoy', 5, 5)]);
    const r = resolveCell(b, cell(5, 5));
    expect(r.outcome).toBe('decoy_hit');
    expect(b.marks[5][5]).toBe('hit'); // the attacker cannot tell
  });

  it('is exposed only once all eight neighbours are marked - the lie lasts', () => {
    const d = item('decoy', 5, 5);
    const b = board([ship('boat', 0, 0)], [d]);
    resolveCell(b, cell(5, 5));
    for (const c of [cell(4, 5), cell(6, 5), cell(5, 4), cell(5, 6)]) resolveCell(b, c);
    expect(b.marks[5][5]).toBe('hit'); // four neighbours are not enough
    for (const c of [cell(4, 4), cell(4, 6), cell(6, 4)]) resolveCell(b, c);
    expect(d.state).toBe('hit');
    resolveCell(b, cell(6, 6));
    expect(d.state).toBe('exposed');
    expect(b.marks[5][5]).toBe('decoy');
  });

  it('stops a torpedo, protecting the ships further down the row', () => {
    const b = board([ship('cruiser', 4, 6)], [item('decoy', 4, 2)]);
    const a = useWeapon(b, 'torpedo', cell(4, 0));
    expect(a.resolutions[0].outcome).toBe('decoy_hit');
    expect(b.layout.ships[0].hit.some(Boolean)).toBe(false);
    expect(a.keepsTurn).toBe(true);
  });

  it('is never counted by radar - radar never lies', () => {
    const b = board([ship('boat', 0, 0)], [item('decoy', 5, 5)]);
    expect(useWeapon(b, 'radar', cell(5, 5)).radarCount).toBe(0);
  });

  it('may not touch a ship, so a sinking ship can never expose it', () => {
    const layout = randomLayout(7, { decoy: 2, mine: 3 });
    expect(validateLayout(layout)).toBeNull();
    const bad = {
      ...layout,
      items: [...layout.items, { id: 'x', kind: 'decoy' as const, cell: layout.ships[0].cells[0], state: 'live' as const }],
    };
    expect(validateLayout(bad)).not.toBeNull();
  });

  it('does not count towards the fleet - sinking every ship still ends the raid', () => {
    const b = board([ship('boat', 0, 0)], [item('decoy', 5, 5)]);
    resolveCell(b, cell(0, 0));
    expect(b.layout.ships.every((s) => s.hit.every(Boolean))).toBe(true);
  });
});

describe('Minesweeper - the first counter to mines', () => {
  it('disarms every live mine in the two swept rows and shows them', () => {
    const b = board(
      [ship('boat', 0, 0)],
      [item('mine', 4, 1), item('mine', 5, 7), item('mine', 7, 3)],
    );
    const a = useWeapon(b, 'minesweeper', cell(4, 0));
    expect(a.disarmed).toHaveLength(2);
    expect(b.marks[4][1]).toBe('mine_disarmed');
    expect(b.marks[5][7]).toBe('mine_disarmed');
    expect(b.marks[7][3]).toBe('unknown');
    expect(b.layout.items[2].state).toBe('live');
  });

  it('is a free action: it never ends your turn', () => {
    const b = board([ship('boat', 0, 0)], []);
    const a = useWeapon(b, 'minesweeper', cell(4, 0));
    expect(a.disarmed).toHaveLength(0);
    expect(a.keepsTurn).toBe(true);
  });

  it('a disarmed mine can never be fired on again', () => {
    const b = board([ship('boat', 0, 0)], [item('mine', 4, 1)]);
    useWeapon(b, 'minesweeper', cell(4, 0));
    expect(resolveCell(b, cell(4, 1)).outcome).toBe('illegal');
  });

  it('is not an aircraft: no AA gun can stop it', () => {
    const b = board([ship('boat', 0, 0)], [item('aa_gun', 4, 9), item('mine', 4, 1)]);
    const a = useWeapon(b, 'minesweeper', cell(4, 0));
    expect(a.intercepted).toBeUndefined();
    expect(a.disarmed).toHaveLength(1);
  });

  it('sweeping the last row pairs I and J, like the double torpedo', () => {
    const b = board([ship('boat', 0, 0)], [item('mine', 8, 2), item('mine', 9, 2)]);
    expect(useWeapon(b, 'minesweeper', cell(9, 0)).disarmed).toHaveLength(2);
  });
});
