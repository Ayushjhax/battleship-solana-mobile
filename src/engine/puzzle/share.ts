/**
 * The emoji grid — part-09 §2, tested by §5.4.
 *
 * "**Share result** as an emoji grid — this is the cheapest marketing the game
 *  will ever get ... Copy to clipboard; no share sheet dependency needed."
 *
 * That last clause is why this is a pure string function and not a component:
 * `expo-clipboard` is already a dependency, and §1's image share is NOT built
 * because no view-shot dependency exists and §1 says never to add one.
 */
import { coordKey } from '../board';
import type { Marks } from '../types';
import { PUZZLE_PAR, puzzleNumber } from './puzzle';

/** §2 — "🟥 hit, 🟦 miss, ⬜ never fired." */
export const EMOJI = {
  hit: '🟥',
  miss: '🟦',
  blank: '⬜',
} as const;

/**
 * A mark becomes one of three squares.
 *
 * `sunk` and the auto-revealed halo both fold into the two visible outcomes:
 * a sunk cell was a hit, and a revealed cell is one the solver never fired at
 * — the halo came free. Showing them separately would leak how much of the
 * solve was search and how much was the no-touch rule doing the work.
 */
function squareFor(mark: string | undefined): string {
  if (mark === 'hit' || mark === 'sunk') return EMOJI.hit;
  if (mark === 'miss' || mark === 'mine' || mark === 'decoy') return EMOJI.miss;
  return EMOJI.blank;
}

/** Exactly ten lines of ten squares. §5.4 asserts both. */
export function emojiGrid(marks: Marks): string {
  const rows: string[] = [];
  for (let r = 0; r < 10; r++) {
    let row = '';
    for (let c = 0; c < 10; c++) row += squareFor(marks[coordKey({ r, c })]);
    rows.push(row);
  }
  return rows.join('\n');
}

/** The whole shareable block, header and all. */
export function shareText(
  date: string,
  shots: number,
  marks: Marks,
  par = PUZZLE_PAR,
): string {
  return [`Port Gazette puzzle #${puzzleNumber(date)} — ${shots} shots (par ${par})`, '', emojiGrid(marks)].join(
    '\n',
  );
}

/** How many squares of each kind — for the tests, and for a summary line. */
export function gridCounts(marks: Marks): { hit: number; miss: number; blank: number } {
  const grid = emojiGrid(marks);
  return {
    hit: [...grid].filter((ch) => ch === EMOJI.hit).length,
    miss: [...grid].filter((ch) => ch === EMOJI.miss).length,
    blank: [...grid].filter((ch) => ch === EMOJI.blank).length,
  };
}
