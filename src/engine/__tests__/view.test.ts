/**
 * projectView is the entire anti-cheat story. Each test serialises the view to
 * JSON and greps it for enemy ship coordinates in both shapes the engine uses
 * — the "r,c" mark key and the {"r":r,"c":c} object — so a leak through ANY
 * field, present or future, fails the suite.
 */
import { describe, expect, it } from 'vitest';
import { coordKey } from '../board';
import { projectView, reduce } from '../match';
import type { ArsenalItem, Coord, MatchState } from '../types';
import { LAYOUT_A, LAYOUT_B, P0, P1, cellsOfLayout, startMatch } from './fixtures';

const keyForms = (cell: Coord) => [`"${coordKey(cell)}"`, JSON.stringify(cell)];

/**
 * Fails if any enemy ship cell outside `allowed` appears anywhere in the enemy
 * half of the view. The view's shape is pinned first, so enemy data cannot
 * hide in some other field — everything outside `enemy` is the viewer's own.
 */
function expectNoLeak(
  state: MatchState,
  viewer: string,
  enemyShipsCells: Coord[],
  allowed: Coord[],
) {
  const view = projectView(state, viewer);
  expect(Object.keys(view).sort()).toEqual([
    'enemy',
    'matchId',
    'mode',
    'moves',
    'phase',
    'turn',
    'winner',
    'you',
  ]);
  expect(view.you.id).toBe(viewer);
  expect(Object.keys(view.enemy).sort()).toEqual([
    'id',
    'marks',
    'ready',
    'revealedItems',
    'shipsRemaining',
    'sunkShips',
  ]);
  const json = JSON.stringify(view.enemy);
  const allowedKeys = new Set(allowed.map(coordKey));
  for (const cell of enemyShipsCells) {
    if (allowedKeys.has(coordKey(cell))) continue;
    for (const form of keyForms(cell)) {
      expect(json, `leaked ${form}`).not.toContain(form);
    }
  }
  return view;
}

describe('projectView — the masking function', () => {
  it('1. a fresh match exposes not one enemy ship cell, and no enemy ships array at all', () => {
    const state = startMatch({ first: P1 });
    const view = expectNoLeak(state, P1, cellsOfLayout(LAYOUT_A), []);
    expect('ships' in view.enemy).toBe(false);
    expect('arsenal' in view.enemy).toBe(false);
    expect(view.enemy.marks).toEqual({});
    expect(view.enemy.sunkShips).toEqual([]);
    expect(view.enemy.shipsRemaining).toBe(10);
    // Your own board is complete.
    expect(view.you.board.ships).toEqual(state.players[1].board.ships);
  });

  it('2. after hits and misses, only the cells actually shot appear', () => {
    let state = startMatch({ first: P1 });
    const shots: Coord[] = [
      { r: 0, c: 0 }, // hit battleship
      { r: 0, c: 1 }, // hit
      { r: 2, c: 4 }, // hit cruiser-2
    ];
    for (const at of shots) state = reduce(state, { type: 'FIRE', playerId: P1, at }).state;
    const view = expectNoLeak(state, P1, cellsOfLayout(LAYOUT_A), shots);
    expect(Object.keys(view.enemy.marks).sort()).toEqual(shots.map(coordKey).sort());
    expect(view.enemy.sunkShips).toEqual([]);
    // The two unhit battleship cells and the rest of cruiser-2 stay dark.
    const json = JSON.stringify(view.enemy);
    expect(json).not.toContain('"0,2"');
    expect(json).not.toContain('"0,3"');
    expect(json).not.toContain('"2,5"');
  });

  it('3. a sunk ship shows its cells and halo — and nothing about any other ship', () => {
    let state = startMatch({ first: P1 });
    for (const at of [
      { r: 4, c: 3 },
      { r: 4, c: 4 },
    ]) {
      state = reduce(state, { type: 'FIRE', playerId: P1, at }).state;
    }
    const sunkCells = [
      { r: 4, c: 3 },
      { r: 4, c: 4 },
    ];
    const view = expectNoLeak(state, P1, cellsOfLayout(LAYOUT_A), sunkCells);
    expect(view.enemy.sunkShips).toEqual([
      { id: 'destroyer-2', class: 'destroyer', cells: sunkCells },
    ]);
    expect(view.enemy.shipsRemaining).toBe(9);
    // The halo is public, but it contains no ship cells by construction.
    const revealed = Object.entries(view.enemy.marks).filter(([, m]) => m === 'revealed');
    expect(revealed).toHaveLength(10);
  });

  it('4. enemy arsenal never leaks: mines, guns and radar stay hidden until the rules reveal them', () => {
    const arsenalA: ArsenalItem[] = [
      { id: 'mine-1', kind: 'mine', at: { r: 9, c: 9 } },
      { id: 'mine-2', kind: 'mine', at: { r: 8, c: 8 } },
      { id: 'gun-1', kind: 'aaGun', at: { r: 4, c: 9 } },
      { id: 'radar-1', kind: 'radar', at: { r: 9, c: 0 } },
    ];
    const arsenalB: ArsenalItem[] = [{ id: 'tb', kind: 'torpedoBomber' }];
    let state = startMatch({ mode: 'advanced', arsenalA, arsenalB, first: P1 });

    const hidden = arsenalA.map((i) => i.at as Coord);
    let json = JSON.stringify(projectView(state, P1).enemy);
    for (const cell of hidden) for (const form of keyForms(cell)) expect(json).not.toContain(form);
    expect(json).not.toContain('mine-1');
    expect(json).not.toContain('gun-1');
    expect(projectView(state, P1).enemy.revealedItems).toEqual([]);

    // A downed plane reveals exactly the gun that shot it — the mines stay dark.
    state = reduce(state, { type: 'USE_ARSENAL', playerId: P1, itemId: 'tb', row: 4 }).state;
    const view = projectView(state, P1);
    expect(view.enemy.revealedItems).toEqual([
      { kind: 'aaGun', at: { r: 4, c: 9 }, destroyed: false },
    ]);
    json = JSON.stringify(view.enemy);
    for (const cell of [
      { r: 9, c: 9 },
      { r: 8, c: 8 },
      { r: 9, c: 0 },
    ]) {
      for (const form of keyForms(cell)) expect(json).not.toContain(form);
    }

    // Triggering a mine makes that one cell public, and only that one.
    state = { ...state, turn: P1 };
    state = reduce(state, { type: 'FIRE', playerId: P1, at: { r: 9, c: 9 } }).state;
    json = JSON.stringify(projectView(state, P1).enemy);
    expect(projectView(state, P1).enemy.marks['9,9']).toBe('mine');
    for (const form of keyForms({ r: 8, c: 8 })) expect(json).not.toContain(form);
  });

  it('is symmetric: bob sees nothing of alice, alice sees nothing of bob', () => {
    const state = startMatch();
    expectNoLeak(state, P1, cellsOfLayout(LAYOUT_A), []);
    expectNoLeak(state, P0, cellsOfLayout(LAYOUT_B), []);
  });

  it('refuses to build a view for a player who is not in the match', () => {
    expect(() => projectView(startMatch(), 'mallory')).toThrow();
  });
});
