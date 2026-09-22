// Harbour raids (Part 6). A raid is one attacker against a saved harbour
// snapshot. There are no turns: the attacker spends shells, and a hit gives the
// shell back - the asynchronous form of "hit, shoot again".

import { Board, Cell, FLEET_CELLS, Layout, hitCellCount, isSunk, makeBoard } from './grid.js';
import { Attack, Resolution, Weapon, resolveCell, useWeapon } from './resolve.js';

export type RaidConfig = {
  shells: number;
  minePenalty: number; // extra shells lost when a mine goes off
  timeLimitMs: number;
};

export const RAID: RaidConfig = { shells: 30, minePenalty: 2, timeLimitMs: 240_000 };

export type RaidEnd = 'cleared' | 'out_of_shells' | 'time' | 'retreat';

export type RaidEvent =
  | { t: number; kind: 'shot'; cell: Cell; resolution: Resolution; shells: number }
  | { t: number; kind: 'weapon'; weapon: Weapon; target: Cell; attack: Attack; shells: number }
  | { t: number; kind: 'end'; reason: RaidEnd };

export type RaidState = {
  board: Board;
  shells: number;
  kit: Partial<Record<Weapon, number>>;
  config: RaidConfig;
  startedAt: number;
  over: boolean;
  endReason?: RaidEnd;
  log: RaidEvent[];
};

export function startRaid(
  layout: Layout,
  kit: Partial<Record<Weapon, number>> = {},
  startedAt = 0,
  config: RaidConfig = RAID,
): RaidState {
  return {
    board: makeBoard(layout),
    shells: config.shells,
    kit: { ...kit },
    config,
    startedAt,
    over: false,
    log: [],
  };
}

export const kitLeft = (s: RaidState) => Object.values(s.kit).reduce((n, v) => n + (v ?? 0), 0);

export function raidScore(s: RaidState) {
  const cellsHit = hitCellCount(s.board);
  const destruction = cellsHit / FLEET_CELLS;
  const battleship = s.board.layout.ships.find((x) => x.cls === 'battleship');
  const battleshipSunk = !!battleship && isSunk(battleship);
  const stars =
    (battleshipSunk ? 1 : 0) + (destruction >= 0.5 ? 1 : 0) + (destruction >= 1 ? 1 : 0);
  return { cellsHit, destruction, battleshipSunk, stars, shipsSunk: s.board.layout.ships.filter(isSunk).length };
}

function maybeEnd(s: RaidState, now: number) {
  if (s.over) return;
  if (s.board.layout.ships.every(isSunk)) return end(s, 'cleared', now);
  if (now - s.startedAt >= s.config.timeLimitMs) return end(s, 'time', now);
  if (s.shells <= 0 && kitLeft(s) === 0) return end(s, 'out_of_shells', now);
}

export function end(s: RaidState, reason: RaidEnd, now = 0) {
  if (s.over) return;
  s.over = true;
  s.endReason = reason;
  s.log.push({ t: now, kind: 'end', reason });
}

export type RaidError = 'raid-over' | 'no-shells' | 'illegal-cell' | 'no-item';

export function fireShell(
  s: RaidState,
  cell: Cell,
  now = 0,
): { error?: RaidError; resolution?: Resolution; shellDelta?: number } {
  if (s.over) return { error: 'raid-over' };
  if (s.shells <= 0) return { error: 'no-shells' };
  const resolution = resolveCell(s.board, cell);
  if (resolution.outcome === 'illegal') return { error: 'illegal-cell' };

  let delta = -1;
  switch (resolution.outcome) {
    case 'hit':
    case 'sunk':
    case 'decoy_hit':
    case 'item_destroyed':
      delta = 0; // the shell is handed back
      break;
    case 'mine':
      delta = -1 - s.config.minePenalty;
      break;
    default:
      delta = -1;
  }
  s.shells = Math.max(0, s.shells + delta);
  s.log.push({ t: now, kind: 'shot', cell, resolution, shells: s.shells });
  maybeEnd(s, now);
  return { resolution, shellDelta: delta };
}

/** Kit items are paid for with raid fuel before the raid, so they cost no shells. */
export function useKit(
  s: RaidState,
  weapon: Weapon,
  target: Cell,
  now = 0,
): { error?: RaidError; attack?: Attack } {
  if (s.over) return { error: 'raid-over' };
  if ((s.kit[weapon] ?? 0) <= 0) return { error: 'no-item' };
  s.kit[weapon] = (s.kit[weapon] ?? 0) - 1;
  const attack = useWeapon(s.board, weapon, target);
  if (attack.mineTriggered) s.shells = Math.max(0, s.shells - s.config.minePenalty);
  s.log.push({ t: now, kind: 'weapon', weapon, target, attack, shells: s.shells });
  maybeEnd(s, now);
  return { attack };
}
