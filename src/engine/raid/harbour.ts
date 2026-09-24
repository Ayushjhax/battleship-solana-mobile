/**
 * The harbour and the raid kit — part-06 §3, §4.
 *
 * A harbour is the standard fleet plus defences bought with Coastal Command's
 * harbour fuel. It is validated on SAVE and refused if illegal: §10 — "an
 * invalid harbour is refused, and the last valid one keeps defending".
 */
import { specFor } from '../arsenal';
import { FLEET_CELL_COUNT, validateFleetComposition } from '../fleet';
import { autoPlaceFleet, validateArsenalPlacement, validateLayout } from '../placement';
import { createRng } from '../rng';
import { terrainForSea, unlockedSeasFor, type SeaId } from '../terrain';
import type { ArsenalItem, ArsenalKind, Board, Ship } from '../types';
import { isAcademyKind } from '../types';
import { coveLevelFor } from './scoring';
import { isRaidKitKind, type HarbourLayout } from './types';

/** NUMBERS.md > Coastal Command. Harbour fuel by level. */
export const HARBOUR_FUEL: readonly number[] = [0, 50, 70, 90, 110, 130, 150];

/** NUMBERS.md > Armory. Raid fuel by level. */
export const RAID_FUEL: readonly number[] = [0, 40, 60, 80, 100, 120];

/** part-06 §3 — item caps by Coastal Command level. Index 0 is unused. */
export interface HarbourCaps {
  readonly mine: number;
  readonly aaGun: number;
  readonly sonar_net: number;
  readonly decoy: number;
}

export const HARBOUR_CAPS: readonly HarbourCaps[] = [
  { mine: 0, aaGun: 0, sonar_net: 0, decoy: 0 },
  { mine: 3, aaGun: 1, sonar_net: 1, decoy: 1 },
  { mine: 4, aaGun: 2, sonar_net: 1, decoy: 1 },
  { mine: 5, aaGun: 2, sonar_net: 2, decoy: 2 },
  { mine: 6, aaGun: 3, sonar_net: 2, decoy: 2 },
  { mine: 7, aaGun: 3, sonar_net: 2, decoy: 3 },
  { mine: 8, aaGun: 4, sonar_net: 3, decoy: 3 },
];

/** §3 — raids unlock at Admiralty 3. Below that: cannot raid, cannot BE raided. */
export const RAID_MIN_ADMIRALTY = 3;

/** Defences a harbour may hold. Radar is excluded on purpose (§3). */
export const HARBOUR_KINDS: readonly ArsenalKind[] = ['mine', 'aaGun', 'sonar_net', 'decoy'];

export type HarbourError =
  | 'bad-fleet'
  | 'bad-placement'
  | 'over-fuel'
  | 'over-cap'
  | 'not-researched'
  | 'not-a-defence'
  | 'needs-admiralty'
  /** Part 10B — the chosen sea is not unlocked by the Lighthouse. */
  | 'sea-locked';

export type HarbourCheck =
  | { readonly ok: true; readonly fuelUsed: number }
  | { readonly ok: false; readonly error: HarbourError; readonly detail: string };

export function harbourFuelFor(coastalCommandLevel: number): number {
  return HARBOUR_FUEL[Math.max(0, Math.min(coastalCommandLevel, HARBOUR_FUEL.length - 1))] ?? 0;
}

export function harbourCapsFor(coastalCommandLevel: number): HarbourCaps {
  const index = Math.max(0, Math.min(coastalCommandLevel, HARBOUR_CAPS.length - 1));
  return HARBOUR_CAPS[index] ?? HARBOUR_CAPS[0]!;
}

export function raidFuelFor(armoryLevel: number): number {
  return RAID_FUEL[Math.max(0, Math.min(armoryLevel, RAID_FUEL.length - 1))] ?? 0;
}

export interface HarbourContext {
  readonly admiraltyLevel: number;
  readonly coastalCommandLevel: number;
  /** Academy unlocks — nets and decoys need them (§3). */
  readonly unlocks: readonly string[];
  /** Part 10B — the Lighthouse level, which gates the seas a harbour may use. */
  readonly lighthouseLevel: number;
}

/**
 * Validates a harbour exactly as §3 and §10 specify. Order matters: the most
 * structural failure is reported first, so a player fixing one thing at a time
 * always gets the most useful message.
 *
 * Part 10B: the sea is validated against the Lighthouse ladder BEFORE the
 * layout, because a fleet legal on one sea may be illegal on another, and the
 * player should be told which problem they actually have.
 */
export function validateHarbour(layout: HarbourLayout, context: HarbourContext): HarbourCheck {
  if (context.admiraltyLevel < RAID_MIN_ADMIRALTY) {
    return { ok: false, error: 'needs-admiralty', detail: `raids unlock at Admiralty ${RAID_MIN_ADMIRALTY}` };
  }

  const sea = layout.sea ?? 'open';
  if (!unlockedSeasFor(context.lighthouseLevel).includes(sea)) {
    return { ok: false, error: 'sea-locked', detail: `${sea} needs a higher Lighthouse` };
  }
  const terrain = terrainForSea(sea);

  const composition = validateFleetComposition(layout.ships);
  if (!composition.ok) return { ok: false, error: 'bad-fleet', detail: composition.reason };

  const placement = validateLayout(layout.ships, terrain);
  if (!placement.ok) return { ok: false, error: 'bad-placement', detail: placement.reason };

  const caps = harbourCapsFor(context.coastalCommandLevel);
  const budget = harbourFuelFor(context.coastalCommandLevel);

  const counts = new Map<ArsenalKind, number>();
  let fuelUsed = 0;
  const placed: ArsenalItem[] = [];
  const board: Board = { ships: layout.ships, arsenal: [], marks: {} };

  for (const item of layout.arsenal) {
    if (!HARBOUR_KINDS.includes(item.kind)) {
      // Radar lands here: "there is nobody there to read it" (§3).
      return { ok: false, error: 'not-a-defence', detail: `${item.kind} is not a harbour defence` };
    }
    if (isAcademyKind(item.kind) && !context.unlocks.includes(item.kind)) {
      return { ok: false, error: 'not-researched', detail: `${item.kind} has not been researched` };
    }

    const next = (counts.get(item.kind) ?? 0) + 1;
    counts.set(item.kind, next);
    const cap = caps[item.kind as keyof HarbourCaps] ?? 0;
    if (next > cap) {
      return { ok: false, error: 'over-cap', detail: `${item.kind}: max ${cap} at this Coastal Command level` };
    }

    const check = validateArsenalPlacement({ ...board, arsenal: placed }, item, terrain);
    if (!check.ok) return { ok: false, error: 'bad-placement', detail: `${item.id}: ${check.reason}` };
    placed.push(item);

    fuelUsed += specFor(item.kind).cost;
  }

  if (fuelUsed > budget) {
    return { ok: false, error: 'over-fuel', detail: `${fuelUsed} > ${budget} harbour fuel` };
  }
  return { ok: true, fuelUsed };
}

/**
 * §3 — "When raids unlock, the server generates a legal default harbour
 * (random fleet, defences filling the budget) so nobody is ever raidable with
 * an empty board."
 *
 * Seeded from the user id, so it is reproducible and a regenerate gives the
 * same board rather than a quietly different one.
 */
export function generateDefaultHarbour(
  seed: number,
  context: HarbourContext,
  sea: SeaId = 'open',
): HarbourLayout {
  const rng = createRng(seed);
  const terrain = terrainForSea(sea);
  const ships: Ship[] = autoPlaceFleet(rng, terrain);

  const caps = harbourCapsFor(context.coastalCommandLevel);
  const budget = harbourFuelFor(context.coastalCommandLevel);
  const arsenal: ArsenalItem[] = [];
  let fuel = 0;

  // Mines first: §2's calibration says they are the best fuel-for-fuel
  // defence, so a generated harbour should not be a pushover.
  const order: ArsenalKind[] = ['mine', 'aaGun'];
  for (const kind of order) {
    const cap = caps[kind as keyof HarbourCaps] ?? 0;
    const cost = specFor(kind).cost;
    for (let n = 0; n < cap; n++) {
      if (fuel + cost > budget) break;
      const item = placeSomewhere(rng, ships, arsenal, kind, `${kind}-${n + 1}`, terrain);
      if (!item) break;
      arsenal.push(item);
      fuel += cost;
    }
  }

  return { ships, arsenal, sea };
}

/** Finds a legal cell for an item, giving up rather than looping forever. */
function placeSomewhere(
  rng: ReturnType<typeof createRng>,
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  kind: ArsenalKind,
  id: string,
  terrain: ReturnType<typeof terrainForSea>,
): ArsenalItem | null {
  const board: Board = { ships, arsenal, marks: {} };
  for (let attempt = 0; attempt < 120; attempt++) {
    const candidate: ArsenalItem = { id, kind, at: { r: rng.int(10), c: rng.int(10) } };
    if (validateArsenalPlacement(board, candidate, terrain).ok) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The raid kit (§4)
// ---------------------------------------------------------------------------

export type KitError = 'not-offensive' | 'over-cap' | 'over-fuel' | 'not-researched';

export type KitCheck =
  | { readonly ok: true; readonly fuelUsed: number }
  | { readonly ok: false; readonly error: KitError; readonly detail: string };

/**
 * §4 — "every offensive item the player has ... at match prices and match
 * caps", inside the Armory's raid fuel. Defences are not buyable as a kit.
 */
export function validateKit(
  kit: Readonly<Partial<Record<ArsenalKind, number>>>,
  context: { readonly armoryLevel: number; readonly unlocks: readonly string[] },
): KitCheck {
  const budget = raidFuelFor(context.armoryLevel);
  let fuelUsed = 0;

  for (const [rawKind, rawCount] of Object.entries(kit)) {
    const kind = rawKind as ArsenalKind;
    const count = rawCount ?? 0;
    if (count <= 0) continue;

    const spec = specFor(kind);
    if (!isRaidKitKind(kind)) {
      return { ok: false, error: 'not-offensive', detail: `${kind} cannot go in a raid kit` };
    }
    if (isAcademyKind(kind) && !context.unlocks.includes(kind)) {
      return { ok: false, error: 'not-researched', detail: `${kind} has not been researched` };
    }
    if (count > spec.max) {
      return { ok: false, error: 'over-cap', detail: `${kind}: max ${spec.max}` };
    }
    fuelUsed += spec.cost * count;
  }

  if (fuelUsed > budget) {
    return { ok: false, error: 'over-fuel', detail: `${fuelUsed} > ${budget} raid fuel` };
  }
  return { ok: true, fuelUsed };
}

export { FLEET_CELL_COUNT };

/**
 * §5 — a pirate cove's harbour. The same generator as a default harbour, with
 * the Coastal Command level implied by the searcher's renown, so a strong
 * raider meets a defended cove and a new one does not.
 *
 * Seeded, so `cove_seed` in the raid row is enough to rebuild it exactly for
 * the replay: the layout is never the only copy of itself.
 */
export function generateCoveHarbour(seed: number, renown: number): HarbourLayout {
  const level = Math.max(1, Math.min(coveLevelFor(renown), HARBOUR_CAPS.length - 1));
  return generateDefaultHarbour(
    seed,
    {
      admiraltyLevel: RAID_MIN_ADMIRALTY,
      coastalCommandLevel: level,
      // A cove is the house's, so it is not gated on anyone's research.
      unlocks: ['sonar_net', 'decoy', 'minesweeper'],
      // And it stays on Open Sea: nothing in the docs asks for more.
      lighthouseLevel: 0,
    },
    'open',
  );
}
