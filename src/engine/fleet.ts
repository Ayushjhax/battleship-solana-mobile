/**
 * The fleet table from docs/brief.md 3.1. Eight ships, eighteen cells: the
 * classic ten-ship fleet minus two of the four one-cell boats, which made
 * placement fiddly and added little to the game.
 */
import type { PlayerState, Ship, ShipClass } from './types';

export interface FleetSpecEntry {
  readonly class: ShipClass;
  readonly len: number;
  readonly count: number;
}

/** Largest first: that is also the order autoPlaceFleet places them. */
export const FLEET_SPEC: readonly FleetSpecEntry[] = [
  { class: 'battleship', len: 4, count: 1 },
  { class: 'cruiser', len: 3, count: 2 },
  { class: 'destroyer', len: 2, count: 3 },
  { class: 'boat', len: 1, count: 2 },
] as const;

/** Derived from the table so the two can never disagree. */
export const FLEET_SHIP_COUNT = FLEET_SPEC.reduce((n, entry) => n + entry.count, 0); // 8
export const FLEET_CELL_COUNT = FLEET_SPEC.reduce((n, entry) => n + entry.count * entry.len, 0); // 18

export function lengthOf(shipClass: ShipClass): number {
  const entry = FLEET_SPEC.find((e) => e.class === shipClass);
  if (!entry) throw new Error(`unknown ship class: ${shipClass}`);
  return entry.len;
}

/** A ship that has not been placed yet — what the placement tray holds. */
export interface FleetShip {
  readonly id: string;
  readonly class: ShipClass;
  readonly len: number;
}

/** Ids are stable and readable: battleship-1, cruiser-1, cruiser-2, ... */
export function makeFleet(): FleetShip[] {
  const fleet: FleetShip[] = [];
  for (const entry of FLEET_SPEC) {
    for (let n = 1; n <= entry.count; n++) {
      fleet.push({ id: `${entry.class}-${n}`, class: entry.class, len: entry.len });
    }
  }
  return fleet;
}

export function isSunk(ship: Ship): boolean {
  return ship.hits.length >= ship.len;
}

/** Every ship sunk. Arsenal items never count toward the win. */
export function allSunk(player: PlayerState): boolean {
  return player.board.ships.length > 0 && player.board.ships.every(isSunk);
}

/**
 * Exactly the fleet from the table: right number of each class, right length
 * for each. Ids must be unique. Placement validity is checked separately.
 */
export function validateFleetComposition(
  ships: readonly Ship[],
): { ok: true } | { ok: false; reason: string } {
  if (ships.length !== FLEET_SHIP_COUNT) {
    return { ok: false, reason: `expected ${FLEET_SHIP_COUNT} ships, got ${ships.length}` };
  }
  const ids = new Set<string>();
  for (const ship of ships) {
    if (ids.has(ship.id)) return { ok: false, reason: `duplicate ship id ${ship.id}` };
    ids.add(ship.id);
    const entry = FLEET_SPEC.find((e) => e.class === ship.class);
    if (!entry) return { ok: false, reason: `unknown ship class ${String(ship.class)}` };
    if (ship.len !== entry.len) {
      return { ok: false, reason: `${ship.class} must be ${entry.len} long, got ${ship.len}` };
    }
  }
  for (const entry of FLEET_SPEC) {
    const n = ships.filter((s) => s.class === entry.class).length;
    if (n !== entry.count) {
      return { ok: false, reason: `expected ${entry.count} ${entry.class}(s), got ${n}` };
    }
  }
  return { ok: true };
}
