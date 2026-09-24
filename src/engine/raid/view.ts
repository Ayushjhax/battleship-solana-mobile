/**
 * THE RAID'S MASKING FUNCTION — part-06 §6, §10.
 *
 * "The hidden layout is never sent — same rule as §11.4, and there must be a
 * test that fails the build if it ever appears in a raid payload."
 *
 * `raidView()` is the ONLY thing that may leave the session. It is structural,
 * not merely careful: `RaidView` has no field that could hold a layout, so a
 * leak needs someone to add one — and the 500-raid fuzz test in
 * __tests__/secrecy.test.ts then catches it.
 *
 * What is public, and why:
 *   marks         every mark on the harbour was made by THIS raider's shots
 *   sunkShips     every cell of a sunk ship is already marked 'sunk'
 *   revealedItems guns that downed a plane, nets that ate a sub, items shot
 *   shipsRemaining a count, which the HUD shows — never which ships
 *
 * What is NOT, and cannot be:
 *   ships, arsenal, layout, an un-hit cell, an unexposed decoy's kind.
 */
import { cellsOf } from '../board';
import { isSunk } from '../fleet';
import type { Terrain } from '../terrain';
import type { ArsenalKind, Coord, Marks, ShipClass } from '../types';
import { kitLeft, raidScore } from './raid';
import type { KitCounts, RaidEnd, RaidState } from './types';

export interface RaidSunkShipView {
  readonly id: string;
  readonly class: ShipClass;
  readonly cells: readonly Coord[];
}

export interface RaidRevealedItemView {
  readonly kind: ArsenalKind;
  readonly at: Coord;
  readonly destroyed: boolean;
}

/** Everything the attacker may know. There is no `layout` here, by design. */
export interface RaidView {
  readonly marks: Marks;
  readonly sunkShips: readonly RaidSunkShipView[];
  readonly revealedItems: readonly RaidRevealedItemView[];
  readonly shipsRemaining: number;
  /** Part 10B — the harbour's sea, public before the first shell. */
  readonly terrain: Terrain;
  readonly shells: number;
  readonly kit: KitCounts;
  readonly kitLeft: number;
  readonly stars: 0 | 1 | 2 | 3;
  readonly destruction: number;
  readonly over: boolean;
  readonly endReason?: RaidEnd;
  /** Milliseconds left on the 4-minute clock, clamped at 0. */
  readonly msLeft: number;
}

export function raidView(state: RaidState, now = 0): RaidView {
  const score = raidScore(state);

  const sunkShips: RaidSunkShipView[] = state.ships
    .filter(isSunk)
    .map((s) => ({ id: s.id, class: s.class, cells: cellsOf(s) }));

  // An item is revealed only when the RULES made it public: a gun that downed
  // a plane, a net that ate a submarine, an item destroyed by fire, or an
  // EXPOSED decoy. A decoy that has merely been hit is `used` but not
  // `revealed`, so it never appears here — that is Part 5's whole item.
  const revealedItems: RaidRevealedItemView[] = state.arsenal
    .filter((i) => i.at !== undefined && (i.revealed === true || i.destroyed === true))
    .map((i) => ({
      kind: i.kind,
      at: i.at as Coord,
      destroyed: i.destroyed === true,
    }));

  return {
    marks: { ...state.marks },
    sunkShips,
    revealedItems,
    shipsRemaining: state.ships.length - sunkShips.length,
    terrain: state.terrain,
    shells: state.shells,
    kit: { ...state.kit },
    kitLeft: kitLeft(state),
    stars: score.stars,
    destruction: score.destruction,
    over: state.over,
    ...(state.endReason ? { endReason: state.endReason } : {}),
    msLeft: Math.max(0, state.config.timeLimitMs - (now - state.startedAt)),
  };
}

/**
 * The post-raid reveal — §8: "once the raid is over, the full layout, exactly
 * as Clash of Clans does". Deliberately a SEPARATE function with `over` in its
 * name, so calling it mid-raid is a visible mistake rather than a quiet leak.
 */
export function raidFinalReveal(state: RaidState): { ships: readonly unknown[]; arsenal: readonly unknown[] } | null {
  if (!state.over) return null;
  return { ships: state.layout.ships, arsenal: state.layout.arsenal };
}
