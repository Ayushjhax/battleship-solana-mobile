/**
 * The Officers' Club roster — part-10 §10A.
 *
 * A captain is ONE ability, and the ability costs fuel out of the same 260.
 * Captains do not level up; service stars are cosmetic. Both players see each
 * other's captain at the arena reveal, so there is always counterplay.
 *
 * THE HOOKS. Every ability is a small object implementing only the hooks it
 * needs — `onMatchStart`, `onShotResolved`, `onTorpedoWouldStrike`,
 * `onItemHit`, `onShipSunk`. Each hook is PURE: it reads its input and returns
 * a decision (or null), and the call site — which already owns a mutable
 * working copy — applies it. Nothing here mutates, reads a clock or draws
 * random numbers, so a replay from the same seed and actions is exact.
 *
 * "FIRES AT MOST ONCE" is enforced at the call site via `captainUsed`, except
 * for Mara: the roster says each of her AA guns survives its first hit, so her
 * charge is per gun and lives on the item as `damaged`. Each gun's first hit
 * still fires exactly once. See DECISIONS.md D34.
 *
 * Rosa is the deliberate exception to the hook shape: she has no hook at all.
 * Her +25 % salvage is applied at settlement (server/src/city/salvage.ts), and
 * the differential test proves she changes nothing inside the match.
 *
 * PURITY: imports only src/engine. See CLAUDE.md > Engine purity.
 */
import type {
  ArsenalItem,
  ArsenalKind,
  Board,
  CaptainId,
  CaptainItemCounts,
  Coord,
  MatchEvent,
} from './types';

export interface CaptainSpec {
  readonly id: CaptainId;
  readonly name: string;
  /** Fuel out of the same 260 the arsenal spends. */
  readonly fuel: number;
  readonly ability: string;
}

/** part-10 §10A — the roster, verbatim. Do not tune a fuel number here. */
export const CAPTAINS: readonly CaptainSpec[] = [
  {
    id: 'berhan',
    name: 'Berhan, the Gunner',
    fuel: 45,
    ability: 'Steady hand: the first plain shot of the match that misses does not end your turn.',
  },
  {
    id: 'mara',
    name: 'Mara, the Engineer',
    fuel: 25,
    ability:
      'Reinforced mounts: each of your AA guns survives its first hit (damaged, still guarding); the second destroys it.',
  },
  {
    id: 'ivo',
    name: 'Ivo, the Spy',
    fuel: 15,
    ability:
      'Intelligence: at the start of the match you are told how many mines, guns, nets and decoys the enemy placed.',
  },
  {
    id: 'tomas',
    name: 'Tomas, the Navigator',
    fuel: 30,
    ability:
      'Evasive: the first enemy torpedo that would strike one of your ships passes under it and carries on.',
  },
  {
    id: 'rosa',
    name: 'Rosa, the Quartermaster',
    fuel: 0,
    ability: 'Salvager: +25 % salvage from this match. No effect inside the battle at all.',
  },
  {
    id: 'oldCaptain',
    name: 'The Old Captain',
    fuel: 20,
    ability:
      'Seasoned: when your first ship is sunk, you are handed one free radar ping to use from the Arsenal tab.',
  },
] as const;

const BY_ID: Readonly<Record<CaptainId, CaptainSpec>> = Object.fromEntries(
  CAPTAINS.map((captain) => [captain.id, captain]),
) as Readonly<Record<CaptainId, CaptainSpec>>;

export function captainSpec(id: CaptainId): CaptainSpec {
  return BY_ID[id];
}

export function captainFuel(id: CaptainId | null | undefined): number {
  return id ? captainSpec(id).fuel : 0;
}

const IDS = new Set<string>(CAPTAINS.map((captain) => captain.id));

export function isCaptainId(value: unknown): value is CaptainId {
  return typeof value === 'string' && IDS.has(value);
}

/** Ivo's four kinds. A literal list, like the raid kit's — not a filter. */
export const IVO_KINDS = ['mine', 'aaGun', 'sonar_net', 'decoy'] as const;

/** Counts of the four defensive kinds on `board`. Counts only, never cells. */
export function itemCounts(board: Board): CaptainItemCounts {
  const counts: Record<keyof CaptainItemCounts, number> = {
    mine: 0,
    aaGun: 0,
    sonar_net: 0,
    decoy: 0,
  };
  for (const item of board.arsenal) {
    if (item.kind === 'mine' || item.kind === 'aaGun' || item.kind === 'sonar_net' || item.kind === 'decoy') {
      counts[item.kind] += 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

/** What a fired hook hands back. The call site applies the decision. */
export interface AbilityFire {
  readonly events: readonly MatchEvent[];
}

export interface ItemHitDecision extends AbilityFire {
  /** Mara only: true means "this gun survives; mark it damaged". */
  readonly survive: boolean;
}

export interface ShipSunkDecision extends AbilityFire {
  /** The Old Captain only: true means "hand over the free radar". */
  readonly grantRadar: boolean;
}

export interface CaptainAbility {
  readonly id: CaptainId;
  /** Both layouts are in and the match has just started. */
  onMatchStart?(input: { owner: string; enemy: Board }): AbilityFire | null;
  /** A plain FIRE resolved. `miss` is true only for a MISS (never a mine). */
  onShotResolved?(input: { owner: string; at: Coord; miss: boolean }): AbilityFire | null;
  /** A torpedo is about to strike an intact ship cell on the owner's board. */
  onTorpedoWouldStrike?(input: { owner: string; at: Coord }): AbilityFire | null;
  /** A normal shot hit one of the owner's own-board items. */
  onItemHit?(input: {
    owner: string;
    item: { readonly kind: ArsenalKind; readonly damaged?: boolean };
    at: Coord;
  }): ItemHitDecision | null;
  /** One of the owner's ships just sank. `firstShip` is the owner's first loss. */
  onShipSunk?(input: { owner: string; at: Coord; firstShip: boolean }): ShipSunkDecision | null;
}

function abilityEvent(
  owner: string,
  captainId: CaptainId,
  extra: { at?: Coord; counts?: CaptainItemCounts } = {},
): MatchEvent {
  return {
    type: 'CAPTAIN_ABILITY',
    playerId: owner,
    captainId,
    ...(extra.at ? { at: extra.at } : {}),
    ...(extra.counts ? { counts: extra.counts } : {}),
  };
}

export const CAPTAIN_ABILITIES: Readonly<Record<CaptainId, CaptainAbility>> = {
  berhan: {
    id: 'berhan',
    onShotResolved: ({ owner, at, miss }) =>
      miss ? { events: [abilityEvent(owner, 'berhan', { at })] } : null,
  },
  mara: {
    id: 'mara',
    onItemHit: ({ owner, item, at }) =>
      item.kind === 'aaGun' && item.damaged !== true
        ? { survive: true, events: [abilityEvent(owner, 'mara', { at })] }
        : null,
  },
  ivo: {
    id: 'ivo',
    onMatchStart: ({ owner, enemy }) => ({
      events: [abilityEvent(owner, 'ivo', { counts: itemCounts(enemy) })],
    }),
  },
  tomas: {
    id: 'tomas',
    onTorpedoWouldStrike: ({ owner, at }) => ({
      events: [abilityEvent(owner, 'tomas', { at })],
    }),
  },
  rosa: {
    id: 'rosa',
  },
  oldCaptain: {
    id: 'oldCaptain',
    onShipSunk: ({ owner, at, firstShip }) =>
      firstShip
        ? { grantRadar: true, events: [abilityEvent(owner, 'oldCaptain', { at })] }
        : null,
  },
};

/** The id the Old Captain's free radar carries. Stable, so a replay matches. */
export const FREE_RADAR_ID = 'radar-free-1';

/** The free radar item itself. Never priced; never in the shop. */
export function freeRadar(): ArsenalItem {
  return { id: FREE_RADAR_ID, kind: 'radar' };
}

export function abilityFor(id: CaptainId | null): CaptainAbility | null {
  return id ? CAPTAIN_ABILITIES[id] : null;
}
