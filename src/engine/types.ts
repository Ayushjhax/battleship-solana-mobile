/**
 * The vocabulary of a match. Everything in src/engine depends on this file.
 *
 * PURITY: no imports from react, react-native, expo-*, or any other src/
 * directory — ever. The Node match server imports this source directly.
 * See CLAUDE.md > Engine purity.
 *
 * Rules reference: docs/brief.md section 3.
 */
import type { Terrain } from './terrain';

/** Grid is 10 x 10. Rows A-J top to bottom, columns 1-10 left to right. */
export const GRID_SIZE = 10;

/** docs/brief.md 3.3 — turn timer. */
export const TURN_SECONDS = 20;

/** docs/brief.md 3.3 — two consecutive timeouts forfeit the match. */
export const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** docs/brief.md 3.4 — advanced-mode arsenal budget. */
export const FUEL_BUDGET = 260;

/** Internal coordinates are always numeric. Letters are display only. */
export interface Coord {
  readonly r: number; // 0..9
  readonly c: number; // 0..9
}

export type Orientation = 'h' | 'v';

export type MatchMode = 'classic' | 'advanced';

export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'boat';

export interface Ship {
  readonly id: string;
  readonly class: ShipClass;
  readonly len: number;
  /** The first cell; the ship extends right (h) or down (v) from here. */
  readonly origin: Coord;
  readonly orientation: Orientation;
  /** Cells of this ship that have been hit. */
  readonly hits: readonly Coord[];
}

/**
 * docs/brief.md 3.4 — the eight original arsenal kinds, plus the three from
 * the Naval Academy (docs/port-city/part-05-academy-items.md).
 *
 * NAMING: the three new kinds are spelled as the Port City design package
 * spells them (`sonar_net`), not in the camelCase the original eight use
 * (`aaGun`). That is deliberate and was specified; it is the one place in this
 * union where the two conventions meet.
 */
export type ArsenalKind =
  | 'torpedoBomber'
  | 'doubleTorpedoBomber'
  | 'bomber'
  | 'atomicBomber'
  | 'aaGun'
  | 'radar'
  | 'mine'
  | 'submarine'
  /** Part 5: guards a column against submarines as the AA gun guards a row. */
  | 'sonar_net'
  /** Part 5: reads as an ordinary hit and is not there. */
  | 'decoy'
  /** Part 5: sweeps two rows and disarms their mines. Never ends your turn. */
  | 'minesweeper';

/** The three the Naval Academy researches — everything else is always available. */
export const ACADEMY_KINDS = ['sonar_net', 'decoy', 'minesweeper'] as const;
export type AcademyKind = (typeof ACADEMY_KINDS)[number];

export function isAcademyKind(kind: ArsenalKind): kind is AcademyKind {
  return (ACADEMY_KINDS as readonly string[]).includes(kind);
}

/**
 * Part 10A — the six captains of the Officers' Club. One ability each, priced
 * in fuel out of the same 260. The roster (names, fuel, hooks) is
 * `CAPTAINS` in ./captains; this union is the vocabulary, like ArsenalKind.
 */
export type CaptainId = 'berhan' | 'mara' | 'ivo' | 'tomas' | 'rosa' | 'oldCaptain';

/** Ivo's count, per defensive kind. Counts only — never a cell (part-10 §10A). */
export interface CaptainItemCounts {
  readonly mine: number;
  readonly aaGun: number;
  readonly sonar_net: number;
  readonly decoy: number;
}

/** Offensive items are spent on the enemy board; own-board items occupy a cell. */
export type ArsenalPlacement = 'offensive' | 'own board';

export interface ArsenalItem {
  readonly id: string;
  readonly kind: ArsenalKind;
  /** Only for own-board kinds (aaGun, mine, radar). Offensive items have none. */
  readonly at?: Coord;
  /** Spent: an offensive item fired, a radar scanned, a mine detonated. */
  readonly used?: boolean;
  /** An own-board item hit by normal fire. */
  readonly destroyed?: boolean;
  /** The attacker has learned this own-board item's cell (AA gun that downed a plane). */
  readonly revealed?: boolean;
  /**
   * Part 10A — Mara's reinforced mount: an AA gun that has survived its first
   * hit. It still guards (`!destroyed`) and the SECOND hit destroys it. The
   * cell is deliberately left unmarked on the first hit so that second hit is
   * reachable.
   */
  readonly damaged?: boolean;
}

/**
 * What the OPPONENT has learned about a cell.
 *
 * Part 5 adds two: `mine_disarmed` (a mine a minesweeper made safe — it can
 * never trigger and the cell can never be fired on again) and `decoy` (a decoy
 * buoy that has been EXPOSED). An un-exposed decoy is marked `hit`, exactly
 * like a real ship cell, and that indistinguishability is the item.
 */
export type CellState =
  | 'unknown'
  | 'miss'
  | 'hit'
  | 'sunk'
  | 'revealed'
  | 'mine'
  | 'mine_disarmed'
  | 'decoy';

/** Keyed by coordKey(); a missing key means 'unknown'. */
export type Marks = Readonly<Record<string, CellState>>;

/**
 * One player's board. `marks` is what the OPPONENT has learned about it — every
 * mark on a board was made by the other side's shots. That is why an enemy
 * board's marks can be shown to a player in full, and nothing else can.
 */
export interface Board {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly marks: Marks;
}

export interface PlayerState {
  readonly id: string;
  readonly board: Board;
  readonly fuelSpent: number;
  readonly consecutiveTimeouts: number;
  /** Layout submitted and accepted. */
  readonly ready: boolean;
  /** Part 10A — resolved and validated at SUBMIT_LAYOUT. Null means no captain. */
  readonly captainId: CaptainId | null;
  /** The one-shot ability (or, for Mara, one charge per gun) has fired. */
  readonly captainUsed: boolean;
}

export type MatchPhase = 'placing' | 'playing' | 'over';

/**
 * The authoritative state. It holds BOTH boards in full, so it never leaves the
 * process that owns the match — clients only ever get projectView() output.
 * The engine never reads a clock: turn timing is the server's job (TIMEOUT).
 */
export interface MatchState {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seed: number;
  readonly phase: MatchPhase;
  readonly players: readonly [PlayerState, PlayerState];
  /** Player id whose turn it is. First turn is a coin flip from the seed. */
  readonly turn: string;
  readonly winner: string | null;
  /** Actions accepted while playing (FIRE / USE_ARSENAL), for stats and tests. */
  readonly moves: number;
  /**
   * Part 10B — the public sea this match is played on. Classic is always
   * WATER; every sea is a fixed table, so a replay reproduces it exactly.
   */
  readonly terrain: Terrain;
}

/** Actions are requests. The server validates every one of them via reduce(). */
export type MatchAction =
  | {
      type: 'SUBMIT_LAYOUT';
      playerId: string;
      ships: readonly Ship[];
      arsenal: readonly ArsenalItem[];
      /** Part 10A — the captain brought into this match. Absent means none. */
      captainId?: CaptainId | null;
    }
  | { type: 'FIRE'; playerId: string; at: Coord }
  | { type: 'USE_ARSENAL'; playerId: string; itemId: string; at?: Coord; row?: number }
  | { type: 'TIMEOUT'; playerId: string }
  | { type: 'RESIGN'; playerId: string };

export type GameOverReason = 'fleet' | 'forfeit' | 'resign';

/**
 * Events are the animation script the UI replays, in order. `playerId` is the
 * player who acted; cells refer to the OTHER player's board. Every event is
 * safe to broadcast to both players: it only ever names cells that the rules
 * have just made public.
 */
export type MatchEvent =
  | { type: 'REJECTED'; playerId: string; reason: string }
  | { type: 'LAYOUT_ACCEPTED'; playerId: string }
  | { type: 'MATCH_STARTED'; turn: string }
  | { type: 'HIT'; playerId: string; at: Coord }
  | { type: 'MISS'; playerId: string; at: Coord }
  | {
      type: 'SUNK';
      playerId: string;
      shipId: string;
      shipClass: ShipClass;
      cells: readonly Coord[];
    }
  | { type: 'AUTO_REVEAL'; playerId: string; cells: readonly Coord[] }
  | { type: 'MINE_TRIGGERED'; playerId: string; at: Coord }
  | {
      type: 'ITEM_HIT';
      playerId: string;
      kind: ArsenalKind;
      at: Coord;
      /**
       * Part 10A — Mara's first hit leaves the gun damaged and the cell
       * unmarked, so this event must say so: the UI would otherwise resolve
       * the cell and make the second hit unreachable.
       */
      damaged?: boolean;
    }
  | {
      type: 'ARSENAL_USED';
      playerId: string;
      itemId: string;
      kind: ArsenalKind;
      at?: Coord;
      row?: number;
    }
  | {
      type: 'AIRCRAFT_LAUNCHED';
      playerId: string;
      kind: 'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber';
      rows: readonly number[];
      at?: Coord;
      /** Present when an AA gun will intercept this run. */
      interceptAt?: Coord;
    }
  | {
      type: 'BOMB_DROPPED';
      playerId: string;
      kind: 'bomber' | 'atomicBomber';
      at: Coord;
      index: number;
      total: number;
      resolves: boolean;
    }
  | { type: 'AIRCRAFT_DOWNED'; playerId: string; kind: ArsenalKind; gunAt: Coord }
  /**
   * Part 5. A sonar net ate a submarine. Deliberately NOT reused from
   * AIRCRAFT_DOWNED: that event names an aircraft kind and the UI switches on
   * it, so a separate event keeps both animations and both meanings intact.
   */
  | { type: 'SUBMARINE_DETECTED'; playerId: string; netAt: Coord }
  /** Part 5. One mine made safe by a minesweeper. */
  | { type: 'MINE_DISARMED'; playerId: string; at: Coord }
  /** Part 5. The minesweeper's run across its two rows, for the sprite. */
  | { type: 'MINESWEEPER_RUN'; playerId: string; rows: readonly number[] }
  /**
   * Part 5. A decoy's last unmarked neighbour was marked, so the lie is over.
   * Emitted only at exposure — a decoy HIT emits a plain HIT and nothing else,
   * because any extra event would be a tell.
   */
  | { type: 'DECOY_EXPOSED'; playerId: string; at: Coord }
  | { type: 'TORPEDO_TRAVEL'; playerId: string; path: readonly Coord[]; hitAt: Coord | null }
  | { type: 'TORPEDO_RUN'; playerId: string; path: readonly Coord[]; hitAt: Coord | null }
  | { type: 'SUBMARINE_SURFACED'; playerId: string; at: Coord }
  | {
      type: 'NUKE_FLASH';
      playerId: string;
      at: Coord;
      cells: readonly Coord[];
      resolvedCells: readonly Coord[];
    }
  | { type: 'RADAR_RESULT'; playerId: string; at: Coord; count: number }
  /**
   * Part 10A — one captain ability fired. `playerId` is the captain's OWNER,
   * not necessarily the actor: a defensive ability (Mara, Tomas, the Old
   * Captain) fires on the defender's behalf while the attacker is the one
   * rolling dice. Recorded in the match log so the replay and the server
   * agree.
   */
  | {
      type: 'CAPTAIN_ABILITY';
      playerId: string;
      captainId: CaptainId;
      /** The cell the ability fired on, where one exists. */
      at?: Coord;
      /** Ivo's intelligence: counts only, never cells. */
      counts?: CaptainItemCounts;
    }
  | { type: 'TURN_CHANGED'; turn: string }
  | { type: 'TIMEOUT'; playerId: string; consecutive: number }
  | { type: 'RESIGNED'; playerId: string }
  | { type: 'GAME_OVER'; winner: string; reason: GameOverReason };

/** A sunk enemy ship — every cell is already marked, so it is public. */
export interface SunkShipView {
  readonly id: string;
  readonly class: ShipClass;
  readonly cells: readonly Coord[];
}

/** An enemy own-board item the player has learned about. */
export interface RevealedItemView {
  readonly kind: ArsenalKind;
  readonly at: Coord;
  readonly destroyed: boolean;
  /** Part 10A — a gun that survived its first hit (Mara). */
  readonly damaged?: boolean;
}

/**
 * What a single player is allowed to know. projectView() in match.ts builds
 * it: the player's own board in full, and of the enemy ONLY what the rules
 * have made public. There is no `ships` on the enemy side, by design.
 */
export interface PlayerView {
  readonly matchId: string;
  readonly mode: MatchMode;
  readonly phase: MatchPhase;
  readonly turn: string;
  readonly winner: string | null;
  readonly moves: number;
  /**
   * Part 10B — the sea, public to both players from the first frame. It is
   * the board, not knowledge about it: no ship or item information lives here.
   */
  readonly terrain: Terrain;
  readonly you: PlayerState;
  readonly enemy: {
    readonly id: string;
    readonly ready: boolean;
    readonly marks: Marks;
    readonly sunkShips: readonly SunkShipView[];
    readonly shipsRemaining: number;
    readonly revealedItems: readonly RevealedItemView[];
    /** Part 10A — public at the arena reveal by design. */
    readonly captainId: CaptainId | null;
    readonly captainUsed: boolean;
  };
}
