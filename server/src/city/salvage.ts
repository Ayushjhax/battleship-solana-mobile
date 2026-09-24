/**
 * Turning a finished match into a salvage base — part-01 §2.2, §4.
 *
 * "5 steel per cell of every ENEMY ship you sank". The base handed to SQL is
 * `SALVAGE_PER_CELL x cells`; the Scrapyard bonus is applied inside
 * public.credit_salvage, where the city row is already locked.
 *
 * A resign or a forfeit still pays for ships sunk before the end, on both
 * sides (§2.2) — which falls out of reading the final board rather than the
 * winner, so there is no special case here.
 */
import { isSunk } from '@engine/fleet';
import type { MatchState } from '@engine/types';
import { SALVAGE_PER_CELL } from '@engine/city';

/** Cells of every ship on `board` that is sunk. */
function sunkCells(ships: MatchState['players'][0]['board']['ships']): number {
  let cells = 0;
  for (const ship of ships) if (isSunk(ship)) cells += ship.len;
  return cells;
}

/** The classes sunk, biggest first, for the Scrapyard's wreck display (§6). */
function sunkClasses(ships: MatchState['players'][0]['board']['ships']): string[] {
  return ships
    .filter(isSunk)
    .sort((a, b) => b.len - a.len)
    .map((ship) => ship.class);
}

/** What each seat sank, in the same order as `state.players`. */
export function sunkWreckClasses(state: MatchState): [string[], string[]] {
  return [sunkClasses(state.players[1].board.ships), sunkClasses(state.players[0].board.ships)];
}

/**
 * Part 10A — Rosa's +25 % salvage. Applied to the BASE, before the Scrapyard
 * bonus, and floored, exactly like every other salvage figure (DECISIONS D35).
 * She is the only captain whose ability never touches the match.
 */
function withQuartermaster(base: number, captainId: string | null): number {
  return captainId === 'rosa' ? Math.floor(base * 1.25) : base;
}

/**
 * The salvage base each seat earned, in the same order as `state.players`.
 * Player 0 is paid for player 1's sunk ships and vice versa.
 */
export function salvageBases(state: MatchState): [number, number] {
  const a = sunkCells(state.players[1].board.ships) * SALVAGE_PER_CELL;
  const b = sunkCells(state.players[0].board.ships) * SALVAGE_PER_CELL;
  return [
    withQuartermaster(a, state.players[0].captainId),
    withQuartermaster(b, state.players[1].captainId),
  ];
}

/** The base for one player id, or 0 if they are not in this match. */
export function salvageBaseFor(state: MatchState, playerId: string): number {
  const [a, b] = salvageBases(state);
  if (state.players[0].id === playerId) return a;
  if (state.players[1].id === playerId) return b;
  return 0;
}
