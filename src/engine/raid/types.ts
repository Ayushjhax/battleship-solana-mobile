/**
 * Harbour raids — docs/port-city/part-06-raids-engine.md.
 *
 * A raid is ONE attacker against a frozen harbour snapshot. There are no
 * turns: the attacker spends shells, and a hit hands the shell straight back —
 * the asynchronous form of "hit, shoot again".
 *
 * PURITY: this module imports only from src/engine. Every cell resolution and
 * every interception goes through the SAME functions a live match uses, which
 * is what makes a raid obey exactly the rules the match does.
 */
import type { ArsenalItem, ArsenalKind, Coord, Marks, Ship } from '../types';
import type { SeaId, Terrain } from '../terrain';

/** The saved harbour: a legal fleet plus defences, on a chosen sea. */
export interface HarbourLayout {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  /**
   * Part 10B — the sea this harbour defends on. Absent means Open Sea (so
   * every pre-Part-10 harbour row still loads). The Lighthouse level gates
   * which seas may be stored; see validateHarbour.
   */
  readonly sea?: SeaId;
}

/** Server-configurable — part-06 §2 asks for `raid.shells` explicitly. */
export interface RaidConfig {
  readonly shells: number;
  /** Extra shells lost when a mine goes off, on top of the shell itself. */
  readonly minePenalty: number;
  readonly timeLimitMs: number;
  /** Part 10B — the defender's sea, snapshotted so a replay is exact. */
  readonly terrain?: Terrain;
}

/** NUMBERS.md > Raids. Do not tune here; override through server config. */
export const RAID_DEFAULTS: RaidConfig = {
  shells: 30,
  minePenalty: 2,
  timeLimitMs: 240_000,
};

export type RaidEnd = 'cleared' | 'out_of_shells' | 'time' | 'retreat' | 'disconnect';

export type RaidError =
  | 'raid-over'
  | 'no-shells'
  | 'illegal-cell'
  | 'no-item'
  | 'not-in-kit'
  | 'bad-target';

/** What the attacker may hold. §4's list, verbatim. */
export type KitCounts = Readonly<Partial<Record<ArsenalKind, number>>>;

/**
 * §4 — "every offensive item the player has (bomber, atomic bomber, torpedo
 * bomber, double torpedo bomber, submarine, radar, minesweeper if researched)".
 *
 * This is a LITERAL list, not `spec.placement === 'offensive'`, because radar
 * is classified `own board` in src/engine/arsenal.ts (it is held, not placed)
 * yet §4 names it. Deriving the kit from `placement` silently drops it.
 */
export const RAID_KIT_KINDS: readonly ArsenalKind[] = [
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'submarine',
  'radar',
  'minesweeper',
];

export function isRaidKitKind(kind: ArsenalKind): boolean {
  return RAID_KIT_KINDS.includes(kind);
}

export type RaidAction =
  | { readonly kind: 'fire'; readonly at: Coord }
  | { readonly kind: 'use'; readonly weapon: ArsenalKind; readonly at?: Coord; readonly row?: number }
  | { readonly kind: 'retreat' };

/** One entry of the replay log — §8 stores these and re-runs them. */
export interface RaidLogEntry {
  readonly t: number;
  readonly action: RaidAction;
  /** Shells remaining AFTER the action. */
  readonly shells: number;
  readonly shellDelta: number;
}

/**
 * The live raid. `layout` and `board` are SERVER-ONLY: nothing outside
 * raidView() may serialise them. See ./view.ts.
 */
export interface RaidState {
  readonly layout: HarbourLayout;
  /** The working board: ships with hits, items with used/destroyed/revealed, marks. */
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly marks: Marks;
  /** Part 10B — resolved from config.terrain (default water), public to both. */
  readonly terrain: Terrain;
  readonly shells: number;
  readonly kit: KitCounts;
  readonly config: RaidConfig;
  readonly startedAt: number;
  readonly over: boolean;
  readonly endReason?: RaidEnd;
  readonly log: readonly RaidLogEntry[];
  /** Ids of kit weapons already spent, so a replay is deterministic. */
  readonly spent: readonly string[];
}

export interface RaidScore {
  readonly cellsHit: number;
  /** 0..1 of the fleet's cells. Denominator is FLEET_CELL_COUNT — see ./raid.ts. */
  readonly destruction: number;
  readonly battleshipSunk: boolean;
  readonly stars: 0 | 1 | 2 | 3;
  readonly shipsSunk: number;
}

export interface RaidStepResult {
  readonly state: RaidState;
  readonly error?: RaidError;
  readonly shellDelta: number;
  /** Engine events, for the client's animation — safe to send. */
  readonly events: readonly import('../types').MatchEvent[];
}
